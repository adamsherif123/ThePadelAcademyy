-- ============================================================================
-- app_config: the signed-out read the hard update gate depends on (pgTAP).
--
-- What has to be true: anon can read the two version fields and NOTHING else,
-- anon cannot write by any verb, and the authenticated path 045 built is
-- completely unchanged. The column grant is the interesting part — it is what
-- makes `select *` fail for anon, so a column added later is private until
-- somebody opts it in.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(21);

-- ════════════════════════════════════════════════════════════════════════════
-- Shape: the grant is COLUMN-level, and covers exactly two columns
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  has_column_privilege('anon', 'public.app_config', 'latest_ios_version', 'select'),
  'anon may read latest_ios_version');
select ok(
  has_column_privilege('anon', 'public.app_config', 'min_supported_ios_version', 'select'),
  'anon may read min_supported_ios_version');
select ok(
  not has_column_privilege('anon', 'public.app_config', 'updated_at', 'select'),
  'anon may NOT read updated_at — operational metadata is not the gate''s business');
select ok(
  not has_column_privilege('anon', 'public.app_config', 'id', 'select'),
  'anon may NOT read id');
select ok(
  not has_table_privilege('anon', 'public.app_config', 'select'),
  'anon holds no TABLE-wide select — so `select *` fails and a future column is private by default');

-- The GRANT layer, asserted independently of RLS. These three passed vacuously
-- before migration 059: on the real projects anon held all of them (045 never
-- cleared Supabase's default privileges) and only RLS stopped a write. A policy
-- added in error would have opened a path to the one value that can lock every
-- user out of the app, so the privilege layer is asserted here on its own.
select ok(
  not has_table_privilege('anon', 'public.app_config', 'insert'),
  'anon holds NO insert grant — not merely blocked by RLS');
select ok(
  not has_table_privilege('anon', 'public.app_config', 'update'),
  'anon holds NO update grant — not merely blocked by RLS');
select ok(
  not has_table_privilege('anon', 'public.app_config', 'delete'),
  'anon holds NO delete grant — not merely blocked by RLS');
select ok(
  has_table_privilege('authenticated', 'public.app_config', 'select'),
  'authenticated keeps its table-wide select (045''s grant, re-issued by 059)');
select ok(
  not has_table_privilege('authenticated', 'public.app_config', 'update'),
  'authenticated cannot write either — 059 cleared its defaults too');

-- The policy has to exist too: a grant alone reads as an empty set under RLS.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'app_config' and policyname = 'app_config_select_anon'),
  1, 'the anon select policy exists');
select is(
  (select roles::text from pg_policies where policyname = 'app_config_select_anon'),
  '{anon}', 'it is scoped to anon alone');
select is(
  (select cmd from pg_policies where policyname = 'app_config_select_anon'),
  'SELECT', 'it is a SELECT policy — it grants no write path');

-- ════════════════════════════════════════════════════════════════════════════
-- anon: reads what it should, and nothing more
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;

select lives_ok(
  $$ select min_supported_ios_version from public.app_config $$,
  'anon CAN read the floor — this is the query the gate runs signed out');
select is(
  (select count(*)::int from (select latest_ios_version, min_supported_ios_version from public.app_config) q),
  1, 'anon sees the single config row (the policy is not filtering it away)');
select throws_ok(
  $$ select updated_at from public.app_config $$,
  '42501', null, 'anon reading updated_at is denied at the privilege layer');
select throws_ok(
  $$ select * from public.app_config $$,
  '42501', null, 'anon `select *` is denied — the column grant is the enforcement');

-- ════════════════════════════════════════════════════════════════════════════
-- anon: no write path by any verb
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.app_config (id, latest_ios_version) values (2, '9.9') $$,
  '42501', null, 'anon cannot INSERT');
select throws_ok(
  $$ update public.app_config set min_supported_ios_version = '9.9' $$,
  '42501', null, 'anon cannot UPDATE — it could otherwise lock every user out');
select throws_ok(
  $$ delete from public.app_config $$,
  '42501', null, 'anon cannot DELETE');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- authenticated: 045's behaviour is untouched
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select lives_ok(
  $$ select * from public.app_config $$,
  'authenticated still reads the whole row — the soft prompt''s select * is unaffected');
reset role;

select * from finish();
rollback;
