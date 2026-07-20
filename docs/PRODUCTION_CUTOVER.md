# Production cutover checklist

Everything below is a **launch/cutover step** that needs credentials or assets not in
the repo. None of it should be done during development — several steps would break local
dev. Do them once, against the production Supabase project, at launch.

The build itself is complete and hardened; this file is the gap between "works in dev"
and "live for real players."

---

## 1. Auth config — the landmine (guarded)

`supabase/config.toml` ships, **for local dev only**:
- `[auth.sms.test_otp]` — three fixed-code numbers (`+20155555000{1,2,3}` → `123456`).
- `[auth.sms.twilio]` — `enabled = true` with **placeholder** credentials.

If pushed to production these become **fixed-code login backdoors** and a live-but-fake
SMS provider. Config reaches the hosted project via **`supabase config push`** (it pushes
the auth block — not `supabase db push`, which is migrations only). So the danger is a
`supabase config push` while linked to the production project.

**Guard:** `node scripts/check-config.mjs --prod` fails if any test-OTP number or
placeholder provider is present. It is wired into **`pnpm config:push`** — the sanctioned
way to push config to production. `pnpm verify` also runs a dev-safe variant that fails if
a *real* Twilio secret ever gets committed to `config.toml`.

**Cutover steps (production):**
1. **Delete** the entire `[auth.sms.test_otp]` section from `config.toml` (or maintain a
   production config without it).
2. Set the **real SMS/WhatsApp provider**. For WhatsApp OTP, Egypt typically uses Twilio's
   WhatsApp channel or `twilio_verify`. Put real credentials behind **env() substitution**,
   never inline:
   ```toml
   [auth.sms.twilio]
   enabled = true
   account_sid = "env(TWILIO_ACCOUNT_SID)"
   message_service_sid = "env(TWILIO_MESSAGE_SERVICE_SID)"
   auth_token = "env(TWILIO_AUTH_TOKEN)"
   ```
   Export those vars in the deploy shell (from your secrets manager) before pushing.
3. Push with the guard: `pnpm config:push` (refuses if the landmine is still present).
4. Verify a real phone receives an OTP on the production project.

> Do NOT do this in dev: removing the test numbers breaks local sign-in and this repo's
> auth proofs, which rely on the fixed codes.

---

## 2. Crash/error monitoring (Sentry) — one-line activation

The integration is wired and gated; it's a **no-op until you set a DSN**, and always off in
dev. To turn it on:

1. Create a Sentry project (one org, one project per app is fine).
2. Paste the DSN into each build's env — the single activation step:
   - Mobile: `EXPO_PUBLIC_SENTRY_DSN=…` (EAS secret or `.env`).
   - Admin: `VITE_SENTRY_DSN=…` (build env).
   - Edge (webhook): the webhook already emits **structured, alertable** JSON on failure
     (`marker:"PAYMOB_WEBHOOK_ERROR"`, incl. the money-critical `rpc_refused` case). Wire a
     **Supabase log-based alert** (Logs → create alert matching that marker) or a log drain
     → Sentry/Slack. No code change needed to start alerting.
3. Readable stacks (optional, recommended):
   - Mobile: add the config plugin to `app.json` — `["@sentry/react-native/expo", {url, project, organization}]` — add `metro.config.js` with `getSentryExpoConfig(__dirname)`, and set `SENTRY_AUTH_TOKEN` as an EAS secret so EAS uploads source maps at build. (Left out until a real project exists — fake org/project slugs would fail the build.)
   - Admin: enable source maps + upload via `@sentry/vite-plugin` with `SENTRY_AUTH_TOKEN` at build.

Reporting captures unhandled JS errors + promise rejections; the root **error boundaries**
(both apps) turn a render error into a "try again" screen and report it.

## 3. Admin credential

Set the admin's email+password with the supported script (see `apps/admin/ADMIN_ACCESS.md`):
`SUPABASE_URL … SUPABASE_SERVICE_ROLE_KEY … ADMIN_PHONE … ADMIN_EMAIL … ADMIN_PASSWORD … node scripts/set-admin-credential.mjs`. Uses GoTrue's admin API (no raw `auth.users`/`crypt()`); the service_role key comes from your secrets manager and is never committed.

## 4. Store / project cutover (needs your accounts — not in scope here)

- **Production Supabase project**: create it, `supabase link` to it, run `supabase db push`
  (migrations) and `supabase config push` **via `pnpm config:push`** (the guard blocks the
  test-OTP landmine). Set all Edge Function secrets (`supabase secrets set …`: Paymob, HMAC,
  `PUSH_TRIGGER_SECRET`, and — if used — `SENTRY_DSN`). Re-schedule the stale-purchase cron
  (`create extension pg_cron; select cron.schedule('fail-stale-purchases','17 * * * *', $$ select public.fail_stale_purchases(); $$);`) and re-point the Paymob callbacks at the prod webhook.
- **Payments**: switch Paymob from the test integration to the live account (real creds via
  Edge Function secrets), 3DS on a real card.
- **Icons / splash / store listings**: final art + store metadata.
- **iOS push**: APNs key from the Apple account → `eas credentials` → iOS build. Android FCM
  (`google-services.json` + FCM key) for the mobile push proof.
- **App Store / Play**: builds, screenshots, privacy nutrition labels, review submission.

