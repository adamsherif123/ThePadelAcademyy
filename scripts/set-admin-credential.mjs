#!/usr/bin/env node
// Set (or reset) the admin's email+password credential — the SUPPORTED way.
//
// An admin is a `players` row with is_admin=true, and is_admin()/RLS key on auth.uid().
// So the email credential must live on the SAME auth user that owns the admin's player
// row. This script promotes that player and attaches the credential via GoTrue's admin
// API (PUT /auth/v1/admin/users/:id), NOT by writing auth.users with crypt()/gen_salt —
// that touched Supabase's internal auth schema and a GoTrue upgrade could silently break
// it. It targets the EXISTING auth user (found by phone); it NEVER creates a new one, so
// "one auth user, two sign-in methods, is_admin() on auth.uid()" stays intact.
//
// Run OUT-OF-BAND (locally), never from an app. Requires the service_role key in env —
// which never lives in the repo or an app bundle:
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role> \
//   ADMIN_PHONE=+20100xxxxxxx ADMIN_EMAIL=rania@thepadelacademy.eg ADMIN_PASSWORD='<strong>' \
//   node scripts/set-admin-credential.mjs
//
// Prerequisite: the person has already signed up on the MOBILE app (phone OTP), so their
// players row + auth.users row exist.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PHONE = process.env.ADMIN_PHONE; // E.164, e.g. +201234567890
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
if (!URL || !KEY) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service_role — server secret, never committed).');
if (!PHONE || !PHONE.startsWith('+')) die('Set ADMIN_PHONE in E.164 form, e.g. +201234567890.');
if (!EMAIL || !PASSWORD) die('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
if (PASSWORD.length < 10) die('ADMIN_PASSWORD must be at least 10 characters.');

const authHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const digits = PHONE.replace(/[^0-9]/g, ''); // GoTrue stores the phone digits-only

async function findAuthUserByPhone() {
  // Page through the admin users list and match the digits-only phone.
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authHeaders });
    if (!res.ok) die(`admin listUsers failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users ?? [];
    const hit = users.find((u) => (u.phone ?? '') === digits);
    if (hit) return hit.id;
    if (users.length < 200) break; // last page
  }
  return null;
}

const uid = await findAuthUserByPhone();
if (!uid) die(`No auth user for ${PHONE}. Have them sign up on the mobile app first (phone OTP).`);

// 1) Promote the player to admin (service_role bypasses RLS; is_admin is not client-writable).
const promote = await fetch(`${URL}/rest/v1/players?phone=eq.${encodeURIComponent(PHONE)}`, {
  method: 'PATCH',
  headers: { ...authHeaders, Prefer: 'return=representation' },
  body: JSON.stringify({ is_admin: true }),
});
if (!promote.ok) die(`promote to admin failed: ${promote.status} ${await promote.text()}`);
const promoted = await promote.json();
if (!Array.isArray(promoted) || promoted.length === 0) die(`No players row for ${PHONE}.`);

// 2) Attach email + password to that SAME auth user via the supported admin API.
const upd = await fetch(`${URL}/auth/v1/admin/users/${uid}`, {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
if (!upd.ok) die(`set credential failed: ${upd.status} ${await upd.text()}`);

console.log(`✓ Admin ready. auth.uid ${uid} — sign in at the admin app with ${EMAIL}.`);
console.log('  (Same auth user as the phone identity, so auth.uid()/is_admin()/RLS are unchanged.)');
