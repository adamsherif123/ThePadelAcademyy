-- ============================================================================
-- A1 — Admin/player identity separation proof (pgTAP).
--
-- Run with:  supabase test db
-- Proves the invariants the A1 migration makes structural:
--   * a player has NO writable value that grants admin-ness (is_admin() false, and
--     `admins` has no client INSERT path);
--   * an admin has NO player identity — current_player_id() is NULL, so an admin can
--     never act AS a player (book_slot refuses them), yet is_admin() is true;
--   * admin-only RPCs still ADMIT an admin and REJECT a player;
--   * players.is_admin is gone; the admins store exists.
-- Impersonation mirrors rls_test: seed as postgres (RLS bypassed), then `set local
-- role` + request.jwt.claims so auth.uid() returns the acting identity's auth user.
-- Whole file runs in one transaction and is rolled back.
-- ============================================================================
begin;
select plan(13);

-- ── seed (as postgres / superuser) ──────────────────────────────────────────
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),   -- a player
  ('ffffffff-ffff-ffff-ffff-ffffffffffff');   -- an admin (NO player row)

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_a', '+201000000001', 'Ali', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- The admin is an admins row linked to an auth user, with NO matching player.
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

-- ── structural: the old model is gone, the new store is present ─────────────
select hasnt_column('public', 'players', 'is_admin',
  'players.is_admin column is dropped (old admin model removed)');
select has_table('public', 'admins',
  'admins identity store exists');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER (aaaa) — cannot be, and cannot become, an admin
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is((select public.is_admin()), false,
  'a player is NOT an admin (is_admin() false)');
select is((select public.current_player_id()), 'pl_a',
  'a player HAS a player identity (current_player_id resolves)');
select is((select count(*)::int from public.admins), 0,
  'a player sees no admins rows (select-self policy; they have none)');
-- The core "no writable value grants admin": admins has no INSERT grant to authenticated
-- and no write policy, so a player cannot mint themselves an admin identity.
select throws_ok(
  $$ insert into public.admins (id, auth_user_id, display_name, created_at)
       values ('adm_hack', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Hacker', now()) $$,
  '42501', null, 'a player cannot INSERT into admins (out-of-band only)');
-- An admin-only RPC rejects a player via its is_admin() body gate.
select is((select public.grant_credits('pl_a', 'trial', 2, 'x') ->> 'reason'), 'not_admin',
  'admin-only RPC (grant_credits) rejects a player');

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN (ffff) — recognised as admin, but has NO player identity
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

select is((select public.is_admin()), true,
  'an admin is recognised (is_admin() true)');
select ok((select public.current_player_id()) is null,
  'an admin has NO player identity (current_player_id() NULL)');
select is((select count(*)::int from public.admins), 1,
  'an admin sees their own admins row (select-self)');
-- An admin cannot act AS a player: book_slot resolves current_player_id() first, which is
-- NULL, so it refuses before touching any slot — the admin has no player to book for.
select is((select public.book_slot('sl_whatever') ->> 'reason'), 'not_authenticated',
  'an admin cannot book as a player (no current_player_id)');
-- The same admin-only RPC ADMITS the admin.
select is((select public.grant_credits('pl_a', 'trial', 2, 'welcome') ->> 'ok'), 'true',
  'admin-only RPC (grant_credits) admits an admin');
-- Admin reads player data ONLY through is_admin() policies — sees the seeded player
-- without being one. Scoped to the seeded id so it holds whether the DB is empty or not.
select is((select count(*)::int from public.players where id = 'pl_a'), 1,
  'an admin reads a player row via is_admin() policy (sees the seeded player, is not one)');

select * from finish();
rollback;
