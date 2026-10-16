-- ============================================================================
-- app_config: the Android version fields (073) — pgTAP, as the real roles.
--
-- What has to be true: the Android hard gate can read its floor SIGNED OUT, the
-- soft prompt can read latest_android_version signed in, both ship null (inert),
-- anon still reads nothing beyond the four version fields, and no client role —
-- player, coach or admin — can write the value that locks every Android user out.
-- The iOS read paths are asserted unchanged alongside.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(20);

insert into auth.users (id) values
  ('0eeeeeee-0000-0000-0000-0000000000a1'),   -- a player
  ('0fffffff-0000-0000-0000-0000000000a2');   -- an admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_and', '+201900009073', 'And', 'men', 'beginner', now(), '0eeeeeee-0000-0000-0000-0000000000a1');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_and', '0fffffff-0000-0000-0000-0000000000a2', 'AdmAnd', now());

-- ── shape ───────────────────────────────────────────────────────────────────
select has_column('public', 'app_config', 'latest_android_version', 'latest_android_version exists');
select has_column('public', 'app_config', 'min_supported_android_version', 'min_supported_android_version exists');
select col_is_null('public', 'app_config', 'latest_android_version', 'latest_android_version is nullable');
select col_is_null('public', 'app_config', 'min_supported_android_version', 'min_supported_android_version is nullable');
select is(
  (select latest_android_version from public.app_config), null,
  'latest_android_version ships null — no Android prompt until a value is set');
select is(
  (select min_supported_android_version from public.app_config), null,
  'min_supported_android_version ships null — the Android gate ships inert');

-- ── the GRANT layer, independent of RLS ─────────────────────────────────────
select ok(
  not has_table_privilege('anon', 'public.app_config', 'select'),
  'anon still holds no TABLE-wide select — the column grants remain the enforcement');
select ok(
  not has_column_privilege('anon', 'public.app_config', 'updated_at', 'select'),
  'anon still may NOT read updated_at');

-- ── anon: the signed-out gate read ──────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  (select count(*)::int from (select min_supported_android_version from public.app_config) q),
  1, 'anon reads the Android floor — the query the Android gate runs signed out');
select lives_ok(
  $$ select latest_android_version from public.app_config $$,
  'anon may read latest_android_version');
select lives_ok(
  $$ select min_supported_ios_version from public.app_config $$,
  'the iOS gate''s signed-out read is unchanged');
select throws_ok(
  $$ select * from public.app_config $$,
  '42501', null, 'anon `select *` is still denied');
select throws_ok(
  $$ update public.app_config set min_supported_android_version = '9.9' $$,
  '42501', null, 'anon cannot set the Android floor');
reset role;

-- ── a signed-in PLAYER: reads both platforms, writes neither ────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0eeeeeee-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select lives_ok(
  $$ select * from public.app_config $$,
  'a player''s `select *` (the soft prompt read) still works with the new columns');
select is(
  (select latest_android_version from public.app_config), null,
  'a player reads latest_android_version');
select is(
  (select latest_ios_version from public.app_config), '1.0.1',
  'a player still reads latest_ios_version unchanged');
select throws_ok(
  $$ update public.app_config set min_supported_android_version = '9.9' where id = 1 $$,
  '42501', null, 'a player cannot set the Android floor');
select throws_ok(
  $$ update public.app_config set latest_android_version = '9.9' where id = 1 $$,
  '42501', null, 'a player cannot set the Android latest version');
reset role;

-- ── an ADMIN is no more privileged: Android bumps are out-of-band too ───────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0fffffff-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select throws_ok(
  $$ update public.app_config set min_supported_android_version = '9.9' where id = 1 $$,
  '42501', null, 'even an ADMIN cannot set the Android floor from the app');
select throws_ok(
  $$ update public.app_config set latest_android_version = '9.9' where id = 1 $$,
  '42501', null, 'even an ADMIN cannot set the Android latest version from the app');
reset role;

select * from finish();
rollback;
