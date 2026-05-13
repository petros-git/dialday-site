/**
 * POST /api/subscribe
 *
 * Collects TestFlight beta signups. Verifies Cloudflare Turnstile, requires
 * explicit consent (GDPR Art. 6(1)(a)), validates the email shape, and writes
 * one record per email to Workers KV with a snapshot of the consent text the
 * user actually saw.
 *
 * Bump CONSENT_VERSION whenever the user-facing consent label in index.html
 * (#beta-consent-text) changes.
 *
 * Bindings (configured in Cloudflare Pages → Settings):
 *   - EMAIL_LIST       KV namespace binding
 *   - TURNSTILE_SECRET Plaintext env var (secret) — Turnstile site secret
 *
 * Request body (JSON):
 *   { email: string, turnstileToken: string, consent: true, consentText: string }
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
  consent?: unknown;
  consentText?: unknown;
}

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

const CONSENT_VERSION = "2026-05-13-v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TWO_YEARS_SECONDS = 60 * 60 * 24 * 365 * 2;
const CONSENT_TEXT_MAX = 500;

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
  const consentText =
    typeof body.consentText === "string" ? body.consentText.trim() : "";

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { ok: false, message: "Invalid email" });
  }
  if (body.consent !== true) {
    return json(400, { ok: false, message: "Consent required" });
  }
  if (consentText.length < 1 || consentText.length > CONSENT_TEXT_MAX) {
    return json(400, { ok: false, message: "Invalid consent text" });
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
  const subscribedAt = new Date().toISOString();
  const record = {
    subscribedAt,
    ip: clientIP,
    userAgent: request.headers.get("user-agent") || "",
    consentText,
    consentVersion: CONSENT_VERSION,
    consentGivenAt: subscribedAt,
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
