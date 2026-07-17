# Admin access — one-time setup

The admin app signs in with **email + password** (`signInWithPassword`). But an admin
is a **player row with `is_admin = true`**, and `is_admin()` / every RLS policy is
keyed on `auth.uid()`. So the email credential must live on the **same auth user**
that owns the admin's player row — otherwise sign-in works but every policy denies her
and the app is empty.

That auth user is created when the person signs up on the **mobile app** (phone OTP).
Two out-of-band SQL statements then turn that account into an admin login. Run them
against the project database (Supabase dashboard → SQL editor, or the Management API).
There is no in-app UI for either — by design (S5.1): promotion and credential setup
are deliberate, rare, owner-run actions.

Prerequisite: the person has signed up on the mobile app, so a `players` row and its
`auth.users` row exist. Replace `<PHONE_E164>` (e.g. `+201234567890`), `<ADMIN_EMAIL>`,
and `<STRONG_PASSWORD>`.

```sql
-- 1) Promote the player to admin (keyed on their phone identity).
update public.players
   set is_admin = true
 where phone = '<PHONE_E164>';

-- 2) Attach an email + password credential to that SAME auth user, so email login
--    resolves to the same auth.uid() that owns the player row. Pre-confirmed (no SMTP).
--    (pgcrypto's crypt()/gen_salt('bf') produces the bcrypt hash GoTrue verifies.)
update auth.users
   set email               = '<ADMIN_EMAIL>',
       encrypted_password  = crypt('<STRONG_PASSWORD>', gen_salt('bf')),
       email_confirmed_at  = coalesce(email_confirmed_at, now()),
       updated_at          = now()
 where phone = replace('<PHONE_E164>', '+', '');   -- GoTrue stores the phone digits-only
```

The admin now signs in at the admin app with `<ADMIN_EMAIL>` / `<STRONG_PASSWORD>`.
Her `auth.uid()` is unchanged, so nothing about the schema, RLS, or the RPCs moves.

## Password reset
There is **no in-app reset flow** (it would need SMTP, which this project doesn't run).
For a single admin, reset it from the Supabase dashboard (Authentication → Users →
the user → reset/set password), or re-run statement (2) with a new password.

## Cloud dev project (already configured for testing)
On the dev project (`vvfkqydglgyzhdtymaus`), test number `+201555550001` is already an
admin, and the email credential is set to **`rania@thepadelacademy.eg` / `padel-admin-dev`**
— sign into the admin app with those to test. (Real phone numbers can't get an OTP on
the dev project — Twilio is a placeholder — which is another reason the admin uses email.)
