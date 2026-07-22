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

Set the admin's email+password with the supported script — the **single source of truth**
for the credential (see `apps/admin/ADMIN_ACCESS.md`). It is the **only** supported way;
**never** set the password via raw SQL against `auth.users` (a manual change disagrees with
the script and gets silently overwritten on the next run — the mid-session lockout). The
exact one-time production sequence:

```bash
SUPABASE_URL=https://<prod-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
ADMIN_EMAIL=admin@thepadelacademy.eg \
ADMIN_PASSWORD='<strong-password>' \
ADMIN_NAME='Rania' \
node scripts/set-admin-credential.mjs
```

Reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`ADMIN_NAME` (no `ADMIN_PHONE` — admins have no phone). Goes through GoTrue's admin API (no
raw `auth.users`/`crypt()`); refuses if the email already owns a player row. Re-run with the
same email to reset the password. The service_role key comes from your secrets manager and is
never committed.

## 4. Store / project cutover (needs your accounts — not in scope here)

- **Production Supabase project**: create it, `supabase link` to it, run `supabase db push`
  (migrations) and `supabase config push` **via `pnpm config:push`** (the guard runs, though
  the SMS landmine is gone since A2). Set all Edge Function secrets (`supabase secrets set …`: Paymob, HMAC,
  `PUSH_TRIGGER_SECRET`, and — if used — `SENTRY_DSN`). Re-schedule the stale-purchase cron
  (`create extension pg_cron; select cron.schedule('fail-stale-purchases','17 * * * *', $$ select public.fail_stale_purchases(); $$);`) and re-point the Paymob callbacks at the prod webhook.
- **Data seed (required before players can transact)**: the production DB must contain the
  active **packages**, including the **trial package** — a `training_type='trial'`, active,
  1-session package (A5). Without it the once-per-player trial offer never appears and a new
  player has nothing to buy. Seed the standard group/duo/individual packages too. (Cloud dev
  uses `pk_seed_trial1`; production needs its own equivalent active trial row.)
- **InstaPay (live now)**: the request-credits screen shows the academy's real InstaPay
  **mobile number `+201003487025`** (tap-to-copy). Fill in the payee **account name** in
  `apps/mobile/src/app/request-credits.tsx` (`INSTAPAY_PAYEE_NAME`) once Adam confirms it —
  until then it renders "confirming".
- **Payments (Paymob is a flag flip)**: Paymob is mothballed behind `EXPO_PUBLIC_PAYMOB_ENABLED`
  (OFF unless exactly `'true'`) — players currently pay out-of-band via the InstaPay/cash
  request rail. To turn Paymob on at launch: switch Paymob from the test integration to the
  **live account** (real creds via Edge Function secrets), verify **3DS on a real card**, THEN
  set `EXPO_PUBLIC_PAYMOB_ENABLED=true` in the mobile build (EAS secret / `.env`) so the client
  surfaces the checkout. Also confirm `create-checkout` billing works for email-signup players
  who have no phone (A6 sends a placeholder `phone_number` — Paymob requires a non-empty one).
- **Icons / splash / store listings**: final art + store metadata.
- **iOS push**: APNs key from the Apple account → `eas credentials` → iOS build. Android FCM
  (`google-services.json` + FCM key) for the mobile push proof.
- **App Store / Play**: builds, screenshots, privacy nutrition labels, review submission.

