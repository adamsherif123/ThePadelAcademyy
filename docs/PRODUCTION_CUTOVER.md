# Production cutover checklist

Everything below is a **launch/cutover step** that needs credentials or assets not in
the repo. None of it should be done during development — several steps would break local
dev. Do them once, against the production Supabase project, at launch.

The build itself is complete and hardened; this file is the gap between "works in dev"
and "live for real players."

---

## 1. Auth config — email/password (A2)

Auth is **email + password** for both apps (A2 removed phone OTP and Twilio entirely —
no `[auth.sms]`, no `[auth.sms.test_otp]` backdoor numbers, no `[auth.sms.twilio]`). The
old SMS landmine is gone, so `scripts/check-config.mjs` now passes trivially; it stays
wired into `pnpm verify` / `pnpm config:push` as a regression guard (it will fail if an
SMS provider or test-OTP block ever reappears). Config reaches the hosted project via
**`supabase config push`** (the auth block — not `supabase db push`, which is migrations
only).

Email confirmation is currently **OFF** (`[auth.email].enable_confirmations = false`) —
Adam's decision so a new signup can use the account immediately with no SMTP.

**Cutover decision (production):**
1. Decide whether to require **email confirmation**. If yes, set
   `[auth.email].enable_confirmations = true` AND configure a real SMTP server under
   `[auth.email.smtp]` (host/port/user/pass via `env()` substitution — never inline), or
   confirmation emails won't send. The mobile flow currently assumes an immediate session
   after signUp; enabling confirmations means adding a "check your email" step.
2. Set `[auth]` `site_url` / `additional_redirect_urls` to the production URLs (used for
   any confirmation / password-reset email links).
3. Password reset: there is no in-app reset flow (it needs SMTP). Until SMTP is wired,
   resets are done from the Supabase dashboard. Revisit once (1) is decided.
4. Push config with the guard: `pnpm config:push`.

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
  (migrations) and `supabase config push` **via `pnpm config:push`** (the guard runs, though
  the SMS landmine is gone since A2). Set all Edge Function secrets (`supabase secrets set …`: Paymob, HMAC,
  `PUSH_TRIGGER_SECRET`, and — if used — `SENTRY_DSN`). Re-schedule the stale-purchase cron
  (`create extension pg_cron; select cron.schedule('fail-stale-purchases','17 * * * *', $$ select public.fail_stale_purchases(); $$);`) and re-point the Paymob callbacks at the prod webhook.
- **Payments**: switch Paymob from the test integration to the live account (real creds via
  Edge Function secrets), 3DS on a real card.
- **Icons / splash / store listings**: final art + store metadata.
- **iOS push**: APNs key from the Apple account → `eas credentials` → iOS build. Android FCM
  (`google-services.json` + FCM key) for the mobile push proof.
- **App Store / Play**: builds, screenshots, privacy nutrition labels, review submission.

