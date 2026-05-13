# DialDay — marketing site

[dialday.app](https://dialday.app) — the marketing site and TestFlight beta signup for **DialDay**, the CRM for people who sell on the phone.

This is a static, no-build site: plain HTML + Tailwind CDN, with two Cloudflare Pages Functions backing the email collection form. Cloudflare Pages auto-deploys every push to `main`.

## What's in this repo

```
.
├── index.html              Marketing page (hero, features, pricing, FAQ, beta form)
├── privacy.html            Privacy Policy (rebranded from mlm-crm-legal)
├── terms.html              Terms of Service (rebranded from mlm-crm-legal)
├── functions/
│   └── api/
│       ├── subscribe.ts    POST handler — Turnstile + KV write
│       └── _admin/
│           └── export.ts   GET handler — bearer-token CSV export
├── public/
│   ├── favicon.svg
│   └── og-image.svg
├── robots.txt
├── sitemap.xml
├── LICENSE                 MIT
└── README.md               (this file)
```

## Local preview

For HTML-only browsing (no Functions):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To test the Pages Functions locally you need [wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/):

```bash
npx wrangler pages dev .
# open http://localhost:8788
```

Caveat: the local Turnstile challenge will fail without a configured site key + secret. Wire up Turnstile in the Cloudflare dashboard first (see below) and add `TURNSTILE_SECRET` to a `.dev.vars` file in this directory:

```
TURNSTILE_SECRET=your-secret-here
ADMIN_TOKEN=your-admin-token-here
```

`.dev.vars` is gitignored and stays local.

---

## Deploy — step ordered

### 1. Push this repo to GitHub

```bash
git remote -v   # verify the origin points at petros-git/dialday-site
git push -u origin main
```

(If `gh repo create` was run during scaffold, this is already done.)

### 2. Connect to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select the `dialday-site` repo and the `main` branch.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave empty)
   - **Build output directory:** `/`
4. Save and deploy. The first deploy yields a `dialday-site-XXX.pages.dev` URL — keep this open in another tab; you'll need the exact hostname for Turnstile.

### 3. Set up Turnstile

1. Cloudflare dashboard → **Turnstile** → **Add Site**.
2. **Domains:** add **both** `dialday.app` and the exact `*.pages.dev` preview hostname from step 2.
3. **Widget mode:** Managed.
4. Copy the **site key**. In `index.html`, search for `REPLACE_WITH_TURNSTILE_SITE_KEY` and replace with the site key. Commit and push.
5. Copy the **secret**. In the Pages project → **Settings → Environment variables → Production**, add `TURNSTILE_SECRET` = `<secret>`.

### 4. Set up Workers KV

1. Cloudflare dashboard → **Workers & Pages → KV** → **Create namespace** → name it `dialday-emails`.
2. Pages project → **Settings → Functions → KV namespace bindings** → add a binding:
   - **Variable name:** `EMAIL_LIST`
   - **KV namespace:** `dialday-emails`
3. Apply to **Production** (and optionally Preview, with a separate namespace if you want clean test data).

### 5. Set ADMIN_TOKEN (for the CSV export)

Generate a token locally and store it in your password manager:

```bash
openssl rand -hex 32
```

Pages project → **Settings → Environment variables → Production** → add `ADMIN_TOKEN` = `<token>`.

### 6. Enable Web Analytics

Pages project → **Web Analytics** → toggle on. Free, cookieless, no banner required. No script tag changes needed — Cloudflare auto-injects when served through their network.

### 7. Custom domain (do this **after** Cloudflare manages the DNS zone — see next step)

Pages project → **Custom domains** → **Add `dialday.app`**. Pages will auto-create the CNAME and provision SSL.

### 8. Nameserver migration (Namecheap → Cloudflare)

1. Cloudflare dashboard → **Add a site** → enter `dialday.app` → **Free** plan.
2. Cloudflare scans existing DNS — review records (should be empty or minimal at this stage).
3. Note the **two assigned Cloudflare nameservers** (names vary per account, e.g. `*.ns.cloudflare.com`).
4. Namecheap → **Domain List → dialday.app → Manage → Nameservers** → switch from "Namecheap BasicDNS" to **Custom DNS** → paste both Cloudflare nameservers → green checkmark to save.
5. Wait for propagation (typically 15 min – 4 hr; max 48 hr). Cloudflare emails you when the zone becomes active.
6. Once active, go back to **step 7** and add the custom domain in the Pages project.

---

## Pre-launch checklist

- [ ] Turnstile site key replaced in `index.html` (search for `REPLACE_WITH_TURNSTILE_SITE_KEY`)
- [ ] `TURNSTILE_SECRET` env var set on Pages **Production**
- [ ] `EMAIL_LIST` KV binding set on Pages **Production**
- [ ] `ADMIN_TOKEN` env var set, saved in password manager
- [ ] Beta form tested on the `*.pages.dev` preview URL — submission lands in KV (verify via export endpoint)
- [ ] Web Analytics enabled
- [ ] Custom domain shows green padlock (SSL active)
- [ ] Privacy and Terms pages reviewed by a human for residual MLM language
- [ ] OG image (SVG) replaced with a PNG export for broader platform compatibility (Slack, older WhatsApp render PNG more reliably than SVG)

---

## Post-launch

When the App Store binary goes live, swap the TestFlight CTA in `index.html` for an App Store badge. Search for:

```
<!-- TODO: replace with App Store badge on launch -->
```

The TODO comment marks the right block to edit.

---

## Operations

### Export subscribers as CSV

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://dialday.app/api/_admin/export > subscribers.csv
```

The CSV has columns `email,subscribed_at`. Re-run any time — KV is the source of truth.

### Delete a single subscriber

Cloudflare dashboard → **Workers & Pages → KV → dialday-emails** → search for the key `email:<address>` → delete.

### Verify the API locally (against production)

```bash
# Without a Turnstile token, expect 400:
curl -X POST https://dialday.app/api/subscribe \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","turnstileToken":""}'
# {"ok":false,"message":"Missing verification token"}
```

The real path goes through the form on the page, which provides a fresh Turnstile token.

---

## Tech notes

- **Apple-review copy guardrails** are documented at the top of `<body>` in `index.html`, `privacy.html`, and `terms.html`. Anyone editing copy MUST read those guardrails before changing user-facing strings. The MLM-coded language (downline, distributor, network marketing, income claims) is a rejection risk during App Review.
- **No build step.** Tailwind is loaded via CDN. A future migration to compiled Tailwind CLI would improve performance — Lighthouse Performance is gated to ~93 by the runtime CDN cost.
- **Same-origin only.** No CORS headers — the Pages Function is served from the same origin as the form.
- **Stripe / RevenueCat live in the app**, not the marketing site. This repo never sees payment data.
