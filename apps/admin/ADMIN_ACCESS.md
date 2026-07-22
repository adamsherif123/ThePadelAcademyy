# Admin access — one-time setup

The admin app signs in with **email + password** (`signInWithPassword`). An admin is a
row in the **`public.admins`** table — a **separate identity from any player**. `is_admin()`
reads `admins` (keyed on `auth.uid()`); a player row is never involved. The two identities
never cross: an admin has **no** player row (`current_player_id()` is `NULL` for them), and
a player has **no** write path to `admins`.

Because an admin is not a player, an admin does **not** sign up on the mobile app. The
out-of-band script below creates the admin's auth user (email+password) and its `admins`
row directly. There is deliberately **no API, RLS policy, or RPC** that can create an
admin — minting one is a service_role-only action.

## Setup / reset — the supported way

> **Single source of truth:** `scripts/set-admin-credential.mjs` is the **only** supported
> way to set or reset the admin password. The credential is **whatever the last script run
> set it to** — treat the script as authoritative. **Never** set it any other way, and in
> particular **never run raw SQL against `auth.users`** (e.g.
> `update auth.users set encrypted_password = crypt('…', gen_salt('bf'))`). A hand-set SQL
> password disagrees with what the script knows; the next person who re-runs the script (to
> add an admin, reset a password) silently overwrites your manual change — which is exactly
> how someone gets locked out mid-session. If in doubt, re-run the script: it re-establishes
> the known credential.

Use the script, not raw SQL. It goes through GoTrue's **admin API**
(`POST` / `PUT /auth/v1/admin/users`) — the supported contract — instead of writing
`auth.users` with `crypt()/gen_salt()`. Writing the internal auth schema directly is
unsupported and a GoTrue upgrade could silently break the login the academy depends on.
The script creates the auth user if the email is new (or resets its password if it
exists), then inserts the `admins` row with the service_role key. It **refuses** if the
target auth user already owns a player row — admins and players must stay separate, so use
a **distinct email** that is not a player's.

**No mobile-app prerequisite** — the script creates the auth user itself.

```bash
# The service_role key is a SERVER SECRET — from your secrets manager / Supabase
# dashboard (Settings → API). Never commit it; never put it in an app.
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
ADMIN_EMAIL=admin@thepadelacademy.eg \
ADMIN_PASSWORD='<strong-password>' \
ADMIN_NAME='Rania' \
node scripts/set-admin-credential.mjs
```

The admin then signs in at the admin app with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Password reset

Two supported options, both idempotent and both targeting the existing auth user:
- **Re-run the script above** with a new `ADMIN_PASSWORD` (same `ADMIN_EMAIL`), or
- **Supabase dashboard** → Authentication → Users → the user → reset/set password.

There is no in-app reset flow (it would need SMTP, which this project doesn't run).

## Cloud dev project (already configured for testing)

On the dev project (`vvfkqydglgyzhdtymaus`) the admin email is **`admin@thepadelacademy.eg`**.
The **password is not written down in the repo** — it's set via the script and shared with
the team out of band. If you don't have it, reset it: re-run `set-admin-credential.mjs`
against the dev project with a new `ADMIN_PASSWORD` (see above). This admin is an `admins` row
with no player identity (the former `is_admin=true` player "Mo" was migrated into `admins` and
its player identity retired by the A1 migration).

## At launch — production (run once)

Do this **once** against the **production** project, with a **real, strong password chosen at
launch**. That password is **handed to the academy out of band (never committed** — not here,
not in `.env.example`, not anywhere in the repo):

```bash
SUPABASE_URL=https://<prod-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<prod_service_role_key> \
ADMIN_EMAIL=admin@thepadelacademy.eg \
ADMIN_PASSWORD='<real-strong-password-chosen-at-launch>' \
ADMIN_NAME='Rania' \
node scripts/set-admin-credential.mjs
```

## Recovery — if the academy forgets the password

There is **no self-service reset** (that needs SMTP, which this project doesn't run). Until
the post-launch patch below, recovery is: **Adam re-runs `set-admin-credential.mjs`** against
production with a new `ADMIN_PASSWORD` (same `ADMIN_EMAIL`) and hands the new password over out
of band. That's the whole recovery story — deliberately simple for a single admin, and safe
because the script is idempotent and authoritative.

## Known post-launch item — self-service password change

Self-service admin password change (an in-app "change password", which needs SMTP or a
re-auth flow) is a **deliberate post-launch patch — not built yet**. Noted here so it isn't
forgotten. Until it ships, the script is the only path (setup, reset, and recovery all).
