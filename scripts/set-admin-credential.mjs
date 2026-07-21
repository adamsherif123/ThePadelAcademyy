#!/usr/bin/env node
// Create (or reset the password of) an admin — the OUT-OF-BAND path, the ONLY way an
// admin identity is minted.
//
// A1 model: an admin is an `auth.users` row with an email+password credential, linked to
// a `public.admins` row, and with NO player row. Admins and players are SEPARATE
// identities — there is no client INSERT path to `admins` (no grant, no policy, no RPC),
// so admin creation cannot happen through the API. This script is that out-of-band path:
// it runs locally with the service_role key (which never lives in the repo or an app
// bundle) and does two service_role writes GoTrue/PostgREST bypass RLS for —
//   1) create/refresh the auth user's email+password via GoTrue's admin API, and
//   2) insert the `admins` row for that auth user.
// It REFUSES if the target auth user already owns a player row, because that would fuse
// the two identities the model keeps apart.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role> \
//   ADMIN_EMAIL=admin@thepadelacademy.eg ADMIN_PASSWORD='<strong>' ADMIN_NAME='Rania' \
//   node scripts/set-admin-credential.mjs
//
// Unlike a player, an admin does NOT sign up on the mobile app first — this script
// creates the auth user itself. Re-running with the same email just resets the password.
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const NAME = process.env.ADMIN_NAME; // display_name shown in the admin app

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
if (!URL || !KEY) die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service_role — server secret, never committed).');
if (!EMAIL || !PASSWORD) die('Set ADMIN_EMAIL and ADMIN_PASSWORD.');
if (!NAME || !NAME.trim()) die('Set ADMIN_NAME (the admin display name).');
if (PASSWORD.length < 10) die('ADMIN_PASSWORD must be at least 10 characters.');

const authHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const email = EMAIL.toLowerCase();

async function findAuthUserByEmail() {
  // Page through the admin users list and match the email (GoTrue lowercases stored emails).
  for (let page = 1; page <= 50; page += 1) {
    const res = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authHeaders });
    if (!res.ok) die(`admin listUsers failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users ?? [];
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) break; // last page
  }
  return null;
}

// 1) Create the auth user, or reset the password if it already exists.
let uid = await findAuthUserByEmail();
if (uid) {
  const upd = await fetch(`${URL}/auth/v1/admin/users/${uid}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
  });
  if (!upd.ok) die(`reset credential failed: ${upd.status} ${await upd.text()}`);
} else {
  const create = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (!create.ok) die(`create auth user failed: ${create.status} ${await create.text()}`);
  uid = (await create.json()).id;
}

// 2) Separation guard: this auth user must NOT own a player row.
const asPlayer = await fetch(`${URL}/rest/v1/players?auth_user_id=eq.${uid}&select=id`, { headers: authHeaders });
if (!asPlayer.ok) die(`player lookup failed: ${asPlayer.status} ${await asPlayer.text()}`);
const playerRows = await asPlayer.json();
if (Array.isArray(playerRows) && playerRows.length > 0) {
  die(`auth user ${uid} (${email}) already owns player ${playerRows[0].id}. Admins and players must be separate identities — use a distinct email for the admin.`);
}

// 3) Insert the admins row (idempotent on the auth_user_id unique constraint). service_role
//    bypasses RLS; this is the out-of-band creation path clients cannot reach.
const existing = await fetch(`${URL}/rest/v1/admins?auth_user_id=eq.${uid}&select=id`, { headers: authHeaders });
if (!existing.ok) die(`admins lookup failed: ${existing.status} ${await existing.text()}`);
const adminRows = await existing.json();
if (Array.isArray(adminRows) && adminRows.length > 0) {
  console.log(`✓ Admin already existed (${adminRows[0].id}); password refreshed. Sign in at the admin app with ${email}.`);
} else {
  const ins = await fetch(`${URL}/rest/v1/admins`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ id: `adm_${randomUUID()}`, auth_user_id: uid, display_name: NAME.trim(), created_at: new Date().toISOString() }),
  });
  if (!ins.ok) die(`insert admins row failed: ${ins.status} ${await ins.text()}`);
  const [row] = await ins.json();
  console.log(`✓ Admin created (${row.id}) for auth.uid ${uid}. Sign in at the admin app with ${email}.`);
}
console.log('  (Separate identity: no player row, is_admin() true, current_player_id() NULL.)');
