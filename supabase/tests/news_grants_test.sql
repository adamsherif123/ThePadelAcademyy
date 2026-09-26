-- ============================================================================
-- news / news_seen: the grant layer, asserted independently of RLS (pgTAP).
--
-- These tables held `GRANT ALL TO anon` on the live projects — every verb,
-- TRUNCATE included — with only RLS in the way. Migration 060 takes that back.
--
-- The assertions below are all has_table_privilege, NOT "does a query fail":
-- a query failing proves only that SOMETHING stopped it, and for four years the
-- something was RLS. The point of 060 is that the privilege itself is gone, so
-- the privilege itself is what gets asserted.
--
-- NOTE: a local `supabase db reset` does not reproduce the platform's default
-- privileges, so on a fresh local DB several of these would pass even without
-- 060. They are the regression guard; the real proof is the hosted curl run
-- recorded in the session report.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(22);

-- ════════════════════════════════════════════════════════════════════════════
-- anon holds nothing on either table
-- ════════════════════════════════════════════════════════════════════════════
select ok(not has_table_privilege('anon', 'public.news', 'select'), 'anon cannot select news');
select ok(not has_table_privilege('anon', 'public.news', 'insert'), 'anon cannot insert news');
select ok(not has_table_privilege('anon', 'public.news', 'update'), 'anon cannot update news');
select ok(not has_table_privilege('anon', 'public.news', 'delete'), 'anon cannot delete news');
select ok(not has_table_privilege('anon', 'public.news', 'truncate'),
  'anon cannot TRUNCATE news — RLS never filtered this one at all');
select ok(not has_table_privilege('anon', 'public.news_seen', 'select'), 'anon cannot select news_seen');
select ok(not has_table_privilege('anon', 'public.news_seen', 'insert'), 'anon cannot insert news_seen');
select ok(not has_table_privilege('anon', 'public.news_seen', 'update'), 'anon cannot update news_seen');
select ok(not has_table_privilege('anon', 'public.news_seen', 'delete'), 'anon cannot delete news_seen');
select ok(not has_table_privilege('anon', 'public.news_seen', 'truncate'), 'anon cannot TRUNCATE news_seen');

-- ════════════════════════════════════════════════════════════════════════════
-- authenticated holds exactly what its policies use — no more
-- ════════════════════════════════════════════════════════════════════════════
select ok(has_table_privilege('authenticated', 'public.news', 'select'),
  'authenticated can select news (news_select_authenticated)');
select ok(has_table_privilege('authenticated', 'public.news', 'insert'),
  'authenticated can insert news (news_insert_admin gates it)');
select ok(has_table_privilege('authenticated', 'public.news', 'update'),
  'authenticated can update news (news_update_admin gates it)');
select ok(has_table_privilege('authenticated', 'public.news', 'delete'),
  'authenticated can delete news (news_delete_admin gates it)');
select ok(not has_table_privilege('authenticated', 'public.news', 'truncate'),
  'authenticated cannot TRUNCATE news — no policy could stop it if it could');
select ok(has_table_privilege('authenticated', 'public.news_seen', 'select'),
  'authenticated can select news_seen (news_seen_select_own)');
select ok(has_table_privilege('authenticated', 'public.news_seen', 'insert'),
  'authenticated can insert news_seen (news_seen_insert_own)');
select ok(not has_table_privilege('authenticated', 'public.news_seen', 'update'),
  'authenticated CANNOT update news_seen — there is no update policy, so the grant would be dead weight');
select ok(not has_table_privilege('authenticated', 'public.news_seen', 'delete'),
  'authenticated CANNOT delete news_seen — a post stays seen');
select ok(not has_table_privilege('authenticated', 'public.news_seen', 'truncate'),
  'authenticated cannot TRUNCATE news_seen');

-- service_role is deliberately NOT asserted here. Its GRANT ALL is itself one of
-- the platform defaults, so it does not exist on a fresh local reset and any
-- assertion either way would be testing the environment rather than migration
-- 060. What matters is that 060's revoke names only public, anon and
-- authenticated, so service_role is never touched — verified on the hosted
-- projects in the session report, where the grant actually exists.

-- ════════════════════════════════════════════════════════════════════════════
-- RLS is still the second layer, not replaced by the grant change
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  (select relrowsecurity from pg_class where oid = 'public.news'::regclass),
  'RLS still enabled on news');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.news_seen'::regclass),
  'RLS still enabled on news_seen');

select * from finish();
rollback;
