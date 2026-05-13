/**
 * POST /api/subscribe
 *
 * Collects TestFlight beta signups. Verifies Cloudflare Turnstile, validates the
 * email shape, and writes one record per email to Workers KV.
 *
 * Bindings (configured in Cloudflare Pages → Settings):
 *   - EMAIL_LIST       KV namespace binding
 *   - TURNSTILE_SECRET Plaintext env var (secret) — Turnstile site secret
 *
 * Request body  (JSON): { email: string, turnstileToken: string }
 * Response body (JSON): { ok: boolean, message: string }
 * Status codes : 200 ok · 400 bad request · 403 verification failed ·
 *                405 method not allowed · 500 server error
 */

interface Env {
  EMAIL_LIST: KVNamespace;
  TURNSTILE_SECRET: string;
}

interface SubscribeBody {
  email?: unknown;
  turnstileToken?: unknown;
}

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2;

const json = (status: number, body: { ok: boolean; message: string }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return json(400, { ok: false, message: "Invalid request" });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { ok: false, message: "Invalid email" });
  }
  if (!turnstileToken) {
    return json(400, { ok: false, message: "Missing verification token" });
  }

  const clientIP = request.headers.get("CF-Connecting-IP") || "";

  // Verify Turnstile
  const verifyParams = new URLSearchParams();
  verifyParams.set("secret", env.TURNSTILE_SECRET);
  verifyParams.set("response", turnstileToken);
  if (clientIP) verifyParams.set("remoteip", clientIP);

  let verify: TurnstileVerifyResponse;
  try {
    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: verifyParams.toString(),
      }
    );
    verify = (await verifyRes.json()) as TurnstileVerifyResponse;
  } catch {
    return json(500, { ok: false, message: "Verification service unavailable" });
  }

  if (verify.success !== true) {
    return json(403, { ok: false, message: "Verification failed" });
  }

  // Persist
  const record = {
    subscribedAt: new Date().toISOString(),
    ip: clientIP,
    userAgent: request.headers.get("user-agent") || "",
  };

  try {
    await env.EMAIL_LIST.put(`email:${email}`, JSON.stringify(record), {
      expirationTtl: TWO_YEARS_SECONDS,
    });
  } catch {
    return json(500, { ok: false, message: "Could not save subscription" });
  }

  return json(200, { ok: true, message: "Subscribed" });
};
