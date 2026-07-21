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
ADMIN_EMAIL=rania@thepadelacademy.eg \
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

On the dev project (`vvfkqydglgyzhdtymaus`), the admin email credential is
**`admin@thepadelacademy.eg` / `padel-admin-dev`** — sign into the admin app with those to
test. This admin is an `admins` row with no player identity (the former `is_admin=true`
player "Mo" was migrated into `admins` and its player identity retired by the A1
migration).
