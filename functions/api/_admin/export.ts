/**
 * GET /api/_admin/export
 *
 * Lists every subscriber record stored under the `email:` prefix in Workers KV
 * and returns it as a CSV with columns:
 *   email, subscribed_at, consent_version, consent_text, ip
 *
 * Every field is wrapped in double quotes per RFC 4180 — inner quotes are
 * doubled (" → "").
 *
 * Auth: Bearer token in the Authorization header. Constant-time compare against
 * the ADMIN_TOKEN env var.
 *
 * Bindings (configured in Cloudflare Pages → Settings):
 *   - EMAIL_LIST   KV namespace binding
 *   - ADMIN_TOKEN  Plaintext env var (secret)
 *
 * Example:
 *   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
 *        https://dialday.app/api/_admin/export > subscribers.csv
 */

interface Env {
  EMAIL_LIST: KVNamespace;
  ADMIN_TOKEN: string;
}

interface SubscriberRecord {
  subscribedAt?: string;
  ip?: string;
  userAgent?: string;
  consentText?: string;
  consentVersion?: string;
  consentGivenAt?: string;
}

const KV_PREFIX = "email:";

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

const csvField = (value: string | undefined): string =>
  `"${(value ?? "").replace(/"/g, '""')}"`;

const csvRow = (fields: ReadonlyArray<string | undefined>): string =>
  fields.map(csvField).join(",");

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET" },
    });
  }

  const authHeader = request.headers.get("authorization") || "";
  const expectedPrefix = "Bearer ";
  if (!authHeader.startsWith(expectedPrefix) || !env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }
  const provided = authHeader.slice(expectedPrefix.length);
  if (!timingSafeEqual(provided, env.ADMIN_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rows: string[] = [
    csvRow(["email", "subscribed_at", "consent_version", "consent_text", "ip"]),
  ];
  let cursor: string | undefined = undefined;

  while (true) {
    const page: KVNamespaceListResult<unknown> = await env.EMAIL_LIST.list({
      prefix: KV_PREFIX,
      limit: 1000,
      cursor,
    });

    for (const key of page.keys) {
      const email = key.name.slice(KV_PREFIX.length);
      const raw = await env.EMAIL_LIST.get(key.name);
      let parsed: SubscriberRecord = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw) as SubscriberRecord;
        } catch {
          parsed = {};
        }
      }
      rows.push(
        csvRow([
          email,
          parsed.subscribedAt,
          parsed.consentVersion,
          parsed.consentText,
          parsed.ip,
        ])
      );
    }

    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  return new Response(rows.join("\n") + "\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="dialday-subscribers.csv"',
      "cache-control": "no-store",
    },
  });
};
