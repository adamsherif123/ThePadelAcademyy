# Admin access — one-time setup

The admin app signs in with **email + password** (`signInWithPassword`). But an admin
is a **player row with `is_admin = true`**, and `is_admin()` / every RLS policy is keyed
on `auth.uid()`. So the email credential must live on the **same auth user** that owns
the admin's player row — otherwise sign-in works but every policy denies her and the app
is empty.

That auth user is created when the person signs up on the **mobile app** (phone OTP). A
one-time out-of-band script then (a) promotes that player to admin and (b) attaches an
email+password credential to the **same** auth user.

## Setup / reset — the supported way

Use the script, not raw SQL. It goes through GoTrue's **admin API**
(`PUT /auth/v1/admin/users/:id`) — the supported contract — instead of writing
`auth.users` with `crypt()/gen_salt()`. Writing the internal auth schema directly is
unsupported and a GoTrue upgrade could silently break the login the academy depends on.
The script finds the person's **existing** auth user by phone and updates it; it never
creates a new one, so `auth.uid()` — and therefore every RLS policy and `is_admin()` —
is unchanged.

**Prerequisite:** the person has signed up on the mobile app (so their `players` row and
`auth.users` row exist).

```bash
# The service_role key is a SERVER SECRET — from your secrets manager / Supabase
# dashboard (Settings → API). Never commit it; never put it in an app.
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
ADMIN_PHONE=+201234567890 \
ADMIN_EMAIL=rania@thepadelacademy.eg \
ADMIN_PASSWORD='<strong-password>' \
node scripts/set-admin-credential.mjs
```

The admin then signs in at the admin app with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Password reset

Two supported options, both idempotent and both targeting the existing auth user:
- **Re-run the script above** with a new `ADMIN_PASSWORD`, or
- **Supabase dashboard** → Authentication → Users → the user → reset/set password.

There is no in-app reset flow (it would need SMTP, which this project doesn't run).

## Cloud dev project (already configured for testing)

On the dev project (`vvfkqydglgyzhdtymaus`), test number `+201555550001` is already an
admin, and the email credential is set to **`rania@thepadelacademy.eg` / `padel-admin-dev`**
— sign into the admin app with those to test. (Real phone numbers can't get an OTP on the
dev project — Twilio is a placeholder — which is another reason the admin uses email.)
