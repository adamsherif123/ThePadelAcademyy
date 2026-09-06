-- ============================================================================
-- app_config — the single-row config the update prompt reads (pgTAP).
--
-- Proves the read path the client depends on (a signed-in player CAN read the
-- latest version) and, just as importantly, that the row is READ-ONLY to every
-- client role: the academy bumps it out-of-band, and no app — player or admin —
-- may rewrite what counts as the current version.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(9);

insert into auth.users (id) values
  ('0eeeeeee-0000-0000-0000-00000000000e'),   -- a player
  ('0fffffff-0000-0000-0000-00000000000f');   -- an admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_cfg', '+201900009001', 'Cfg', 'men', 'beginner', now(), '0eeeeeee-0000-0000-0000-00000000000e');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_cfg', '0fffffff-0000-0000-0000-00000000000f', 'AdmCfg', now());

-- ── shape + seed (as postgres) ──────────────────────────────────────────────
select is(
  (select count(*)::int from public.app_config),
  1, 'exactly one config row exists');
select is(
  (select latest_ios_version from public.app_config),
  '1.0.1', 'seeded to the version being submitted, so nobody current is told they are behind');
select is(
  (select min_supported_ios_version from public.app_config),
  null, 'min_supported_ios_version starts null — no hard floor, and nothing reads it yet');
select throws_ok(
  $$ insert into public.app_config (id, latest_ios_version) values (2, '9.9.9') $$,
  '23514', null, 'a SECOND row is structurally impossible (check (id = 1))');

-- ── a signed-in PLAYER: reads it, cannot change it ──────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0eeeeeee-0000-0000-0000-00000000000e","role":"authenticated"}', true);

select is(
  (select latest_ios_version from public.app_config),
  '1.0.1', 'a signed-in player CAN read the latest version (the client read path)');
select throws_ok(
  $$ update public.app_config set latest_ios_version = '9.9.9' where id = 1 $$,
  '42501', null, 'a player cannot UPDATE the config');
select throws_ok(
  $$ insert into public.app_config (id, latest_ios_version) values (1, '9.9.9') $$,
  '42501', null, 'a player cannot INSERT into the config');
select throws_ok(
  $$ delete from public.app_config $$,
  '42501', null, 'a player cannot DELETE the config');
reset role;

-- ── an ADMIN is no more privileged here: bumps are out-of-band ──────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0fffffff-0000-0000-0000-00000000000f","role":"authenticated"}', true);
select throws_ok(
  $$ update public.app_config set latest_ios_version = '9.9.9' where id = 1 $$,
  '42501', null, 'even an ADMIN cannot rewrite it from the app — no write policy exists for anyone');
reset role;

select * from finish();
rollback;
