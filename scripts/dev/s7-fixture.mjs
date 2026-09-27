#!/usr/bin/env node
// S7 test fixture — the two-branch world the location toggle needs, on HOSTED DEV.
//
//   node scripts/dev/s7-fixture.mjs up      # build it
//   node scripts/dev/s7-fixture.mjs down    # take it down
//   node scripts/dev/s7-fixture.mjs status  # show what is there now
//
// WHY A SCRIPT AND NOT A SEED: this has to run against the hosted dev project the
// phone actually talks to, as a REAL ADMIN SESSION — the same JWT, the same RLS,
// the same RPCs the admin app uses. A `supabase db` seed would run as postgres and
// prove nothing about the paths a person will use. Everything here is a write an
// admin could make by hand in the admin app; there is no service_role key involved,
// and none is needed.
//
// THE GUARD: it reads the Supabase URL the MOBILE APP is pointed at
// (apps/mobile/.env) and refuses to do anything unless that is the dev project.
// Checking the app's own URL is deliberate — it is the same string the build under
// test uses, so "the fixture ran" and "the app I am holding sees it" cannot come
// apart. There is no flag to override it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_REF = 'vvfkqydglgyzhdtymaus';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE_FILE = path.join(ROOT, 'scripts', 'dev', '.s7-fixture.json');

const BRANCH_NAME = 'S7 QA Branch';
const PACKAGE_NAME = 'S7 QA · Group 4-Pack';

const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const say = (msg) => console.log(msg);

// ── env ──────────────────────────────────────────────────────────────────────
function readEnvFile(rel, required) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    if (!required) return {};
    die(`${rel} not found. It is gitignored and machine-local — ask Adam for it.`);
  }
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const creds = readEnvFile('.env.test.local', true);
const mobileEnv = readEnvFile('apps/mobile/.env', true);

const SUPABASE_URL = mobileEnv.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = mobileEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) die('apps/mobile/.env is missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY.');

// ── THE GUARD ────────────────────────────────────────────────────────────────
// Parsed, not substring-matched: "https://prod.example.com/?x=vvfkqydglgyzhdtymaus"
// contains the dev ref and is not the dev project.
let host;
try { host = new URL(SUPABASE_URL).host; } catch { die(`EXPO_PUBLIC_SUPABASE_URL is not a URL: ${SUPABASE_URL}`); }
const ref = host.split('.')[0];
if (host !== `${DEV_REF}.supabase.co`) {
  die(
    `REFUSING TO RUN — this is not the dev project.\n` +
    `  apps/mobile/.env points at : ${host}  (ref ${ref})\n` +
    `  this fixture only ever runs: ${DEV_REF}.supabase.co\n` +
    `  Nothing was read and nothing was written.`,
  );
}
say(`✓ target is DEV (${host})`);

for (const k of ['DEV_ADMIN_EMAIL', 'DEV_ADMIN_PASSWORD', 'DEV_PLAYER_EMAIL']) {
  if (!creds[k]) die(`.env.test.local is missing ${k}.`);
}

// ── transport ────────────────────────────────────────────────────────────────
let token = null;
const headers = (extra = {}) => ({
  apikey: ANON_KEY,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  'Content-Type': 'application/json',
  ...extra,
});

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ email: creds.DEV_ADMIN_EMAIL, password: creds.DEV_ADMIN_PASSWORD }),
  });
  const body = await res.json();
  // Never echo the response on failure: it can carry the submitted credential back.
  if (!res.ok || !body.access_token) die(`admin sign-in failed (${res.status}). Check DEV_ADMIN_* in .env.test.local.`);
  token = body.access_token;
  say(`✓ signed in as the dev admin (${creds.DEV_ADMIN_EMAIL})`);
}

async function rest(method, pathAndQuery, body, prefer) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: headers(prefer ? { Prefer: prefer } : {}),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) die(`${method} ${pathAndQuery} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const select = (q) => rest('GET', q);
const insert = (table, rows) => rest('POST', table, rows, 'return=representation');
const patch = (table, q, body) => rest('PATCH', `${table}?${q}`, body, 'return=representation');

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) die(`rpc ${name} → ${res.status} ${text}`);
  return JSON.parse(text);
}

// ── state (which rows THIS fixture made) ─────────────────────────────────────
// Gitignored. `down` needs it for the slots it put at the ORIGINAL branch, which
// are otherwise indistinguishable from real ones — a `down` that guessed could
// cancel a session someone else was using.
const readState = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : null);
const writeState = (s) => fs.writeFileSync(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`);
const clearState = () => { if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE); };

const uuid = () => crypto.randomUUID();

/** Beyond the 5-hour booking window by a wide margin, so the day strip has a few days on it. */
function slotTimes(dayOffset) {
  const base = new Date();
  base.setUTCHours(15, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return [0, 90, 180].map((mins) => {
    const start = new Date(base.getTime() + mins * 60_000);
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString() };
  });
}

async function locationsByName() {
  const rows = await select('locations?select=id,name,is_active,is_default,sort_order&order=sort_order');
  return rows;
}

async function findPlayer() {
  const rows = await select(
    `players?select=id,name,gender,level,email&email=eq.${encodeURIComponent(creds.DEV_PLAYER_EMAIL)}`,
  );
  if (rows.length !== 1) {
    die(`expected exactly 1 player for DEV_PLAYER_EMAIL, found ${rows.length}. Sign up in the app first.`);
  }
  return rows[0];
}

async function activeCoaches() {
  const rows = await select('coaches?select=id,name&is_active=eq.true&order=name');
  if (rows.length < 2) die(`need at least 2 active coaches on dev, found ${rows.length}.`);
  return rows;
}

// ── up ───────────────────────────────────────────────────────────────────────
async function up() {
  const player = await findPlayer();
  say(`✓ DEV_PLAYER: ${player.name} (${player.id}) — ${player.gender} / ${player.level}`);

  // 1) The two branches.
  let locations = await locationsByName();
  const oro = locations.find((l) => l.is_default);
  if (!oro) die('no default branch on dev — migration 061 should have seeded one.');

  let qa = locations.find((l) => l.name === BRANCH_NAME);
  if (qa) {
    say(`· branch "${BRANCH_NAME}" already exists (${qa.id})`);
  } else {
    // No id and no is_default: `authenticated` holds no INSERT privilege on those
    // columns (061), so sending them is a 42501. The defaults mint them.
    [qa] = await insert('locations', [{
      name: BRANCH_NAME,
      address: '7 Test Street, Sheikh Zayed, Giza',
      maps_url: 'https://maps.google.com/?q=Sheikh+Zayed+Giza',
      hours_text: 'Thu – Sat · 4:00 PM – 10:00 PM',
      sort_order: 97,
    }]);
    say(`✓ created branch "${BRANCH_NAME}" (${qa.id})`);
  }
  if (!qa.is_active) {
    const r = await rpc('set_location_active', { p_location_id: qa.id, p_is_active: true });
    if (!r.ok) die(`could not activate the QA branch: ${r.reason}`);
    say(`✓ activated "${BRANCH_NAME}"`);
  } else {
    say(`· "${BRANCH_NAME}" is already active`);
  }

  // 2) An active package at the QA branch, so "Credits for <branch>" has something
  //    to say there and the branch-filtered buy list is not empty.
  const existingPkg = await select(
    `packages?select=id,name,is_active&location_id=eq.${qa.id}&name=eq.${encodeURIComponent(PACKAGE_NAME)}`,
  );
  let pkg = existingPkg[0];
  if (pkg) {
    if (!pkg.is_active) {
      [pkg] = await patch('packages', `id=eq.${pkg.id}`, { is_active: true });
      say(`✓ re-activated package "${PACKAGE_NAME}" (${pkg.id})`);
    } else {
      say(`· package "${PACKAGE_NAME}" already active (${pkg.id})`);
    }
  } else {
    // location_id EXPLICITLY: omitting it hits the fill-default trigger, which
    // resolves `tpa.` names as the caller and fails with 42501 (see insertPackage).
    [pkg] = await insert('packages', [{
      id: `pk_${uuid()}`, location_id: qa.id, training_type: 'group',
      session_count: 4, price: 240000, name: PACKAGE_NAME, is_active: true,
    }]);
    say(`✓ created package "${PACKAGE_NAME}" (${pkg.id})`);
  }

  // 3) Published, bookable slots at BOTH branches — matched to DEV_PLAYER's
  //    gender/level so they are actually bookable, not merely visible.
  const coaches = await activeCoaches();
  const prior = readState();
  const priorSlots = new Set(prior?.slotIds ?? []);
  const slotRows = [];
  const plan = [
    { loc: oro, coach: coaches[0], day: 2 },
    { loc: qa, coach: coaches[1], day: 3 },
  ];
  for (const { loc, coach, day } of plan) {
    for (const { startsAt, endsAt } of slotTimes(day)) {
      const clash = await select(
        `session_slots?select=id&coach_id=eq.${coach.id}&starts_at=eq.${encodeURIComponent(startsAt)}&status=eq.published`,
      );
      if (clash.length) { say(`· slot at ${startsAt} for ${coach.name} already exists (${clash[0].id})`); priorSlots.add(clash[0].id); continue; }
      slotRows.push({
        id: `sl_${uuid()}`, location_id: loc.id, coach_id: coach.id,
        starts_at: startsAt, ends_at: endsAt, training_type: 'group',
        capacity: 4, gender: player.gender, level: player.level,
        status: 'published', template_id: null,
      });
    }
  }
  if (slotRows.length) {
    const made = await insert('session_slots', slotRows);
    for (const s of made) priorSlots.add(s.id);
    say(`✓ published ${made.length} slots (${plan.map((p) => p.loc.name).join(' + ')}), all well beyond the 5-hour window`);
  } else {
    say('· all fixture slots already published');
  }

  // 4) The wallet: EXACTLY 1 group credit at the original branch, 0 at the QA one.
  //    Spent-out batches (quantity_remaining = 0) are left alone — they are history,
  //    they contribute nothing to a balance, and delete_credit_batch rightly refuses
  //    any batch that was booked against.
  const live = await select(
    `credit_batches?select=id,training_type,quantity_remaining,location_id,source&player_id=eq.${player.id}&quantity_remaining=gt.0`,
  );
  for (const b of live) {
    const r = await rpc('delete_credit_batch', { p_batch_id: b.id });
    if (!r.ok) {
      die(
        `could not clear credit batch ${b.id} (${b.training_type}, ${b.quantity_remaining} left): ${r.reason}.\n` +
        `  The wallet cannot be reset to a known state, so the fixture stopped rather than\n` +
        `  leave you testing against an unknown balance. Resolve that batch in the admin app.`,
      );
    }
    say(`✓ cleared batch ${b.id} (${b.training_type} ×${b.quantity_remaining} @ ${b.location_id})`);
  }
  const grant = await rpc('grant_credits', {
    p_player_id: player.id, p_training_type: 'group', p_quantity: 1,
    p_note: 'S7 fixture: one group credit at the original branch', p_location_id: oro.id,
  });
  if (!grant.ok) die(`grant_credits failed: ${grant.reason}`);
  say(`✓ granted 1 group credit at ${oro.name} (${grant.credit_batch_id})`);

  writeState({
    createdAt: new Date().toISOString(),
    ref: DEV_REF,
    playerId: player.id,
    qaLocationId: qa.id,
    packageId: pkg.id,
    slotIds: [...priorSlots],
    creditBatchId: grant.credit_batch_id,
  });
  await status();
}

// ── down ─────────────────────────────────────────────────────────────────────
async function down() {
  const state = readState();
  if (!state) {
    die(
      `no ${path.relative(ROOT, STATE_FILE)} — nothing recorded to take down.\n` +
      `  It is written by \`up\` and is gitignored, so a fresh clone has none.\n` +
      `  If the fixture is on dev but the file is gone, deactivate "${BRANCH_NAME}" in\n` +
      `  the admin app (Locations) after cancelling its sessions; a \`down\` that guessed\n` +
      `  which slots were the fixture's could cancel a real one.`,
    );
  }

  // Slots first: set_location_active(false) refuses while the branch has future
  // published sessions. cancel_session is the real path — atomic, refunding, and
  // idempotent on an already-cancelled slot.
  let cancelled = 0;
  for (const id of state.slotIds ?? []) {
    const r = await rpc('cancel_session', { p_slot_id: id });
    // slot_missing / already_cancelled are the idempotent cases — a second `down`
    // is not an error. Anything else is worth seeing.
    if (r.ok) cancelled += 1;
    else if (r.reason !== 'slot_missing' && r.reason !== 'already_cancelled') say(`· could not cancel slot ${id}: ${r.reason}`);
  }
  say(`✓ cancelled ${cancelled} fixture session${cancelled === 1 ? '' : 's'}`);

  if (state.packageId) {
    // delete_package hard-deletes an untouched package and RETIRES one that has
    // purchases or credit requests behind it — either is a clean take-down.
    const r = await rpc('delete_package', { p_package_id: state.packageId });
    if (r.ok) say(`✓ package ${state.packageId} ${r.action}`);
    else {
      await patch('packages', `id=eq.${state.packageId}`, { is_active: false });
      say(`✓ deactivated package ${state.packageId} (delete refused: ${r.reason})`);
    }
  }

  if (state.creditBatchId) {
    const r = await rpc('delete_credit_batch', { p_batch_id: state.creditBatchId });
    say(r.ok ? `✓ removed the granted credit batch` : `· kept credit batch ${state.creditBatchId} (${r.reason})`);
  }

  if (state.qaLocationId) {
    // A branch is never deleted — slots, templates and packages reference it. It is
    // retired, exactly as a coach or a package is.
    const r = await rpc('set_location_active', { p_location_id: state.qaLocationId, p_is_active: false });
    if (r.ok) say(`✓ deactivated "${BRANCH_NAME}" (branches are retired, never deleted)`);
    else say(`· could not deactivate "${BRANCH_NAME}": ${r.reason}${r.slots ? ` (${r.slots} future slots)` : ''}`);
  }

  clearState();
  say('\nDown. With one active branch the toggle hides itself again — which is the other half of the test.');
  await status();
}

// ── status ───────────────────────────────────────────────────────────────────
async function status() {
  const player = await findPlayer();
  const locations = await locationsByName();
  const active = locations.filter((l) => l.is_active);
  const batches = await select(
    `credit_batches?select=training_type,quantity_remaining,location_id&player_id=eq.${player.id}&quantity_remaining=gt.0`,
  );
  const nowIso = new Date().toISOString();
  const future = await select(
    `session_slots?select=id,location_id&status=eq.published&starts_at=gt.${encodeURIComponent(nowIso)}`,
  );
  const nameOf = (id) => locations.find((l) => l.id === id)?.name ?? id;

  say('\n── dev state ────────────────────────────────────────────────');
  say(`branches        : ${locations.map((l) => `${l.name}${l.is_active ? '' : ' (inactive)'}`).join(', ')}`);
  say(`active branches : ${active.length}  → toggle ${active.length >= 2 ? 'SHOWS' : 'is HIDDEN'}`);
  for (const l of active) {
    say(`  ${l.name.padEnd(20)} future published slots: ${future.filter((s) => s.location_id === l.id).length}`);
  }
  say(`${player.name}'s usable credits:`);
  if (batches.length === 0) say('  (none)');
  for (const b of batches) say(`  ${String(b.quantity_remaining).padStart(2)} × ${b.training_type.padEnd(11)} @ ${nameOf(b.location_id)}`);
  say('─────────────────────────────────────────────────────────────\n');
}

const cmd = process.argv[2];
if (!['up', 'down', 'status'].includes(cmd)) die('usage: node scripts/dev/s7-fixture.mjs up|down|status');
await signIn();
if (cmd === 'up') await up();
else if (cmd === 'down') await down();
else await status();
