-- ============================================================================
-- The stale-bundle fallback, tested as the role it exists for (pgTAP).
--
-- 062 tested this as `postgres`, which holds USAGE on schema tpa and so could
-- never see the failure. These run as `authenticated` — the role an admin
-- bundle actually uses — which is where the trigger was raising
-- "42501 permission denied for schema tpa" on every insert that omitted
-- location_id, i.e. on exactly the path it was written to protect.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(8);

insert into auth.users (id) values ('0b0b0b01-0000-0000-0000-00000000b001');
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id)
  values ('pl_fdl_adm', '+201900050001', 'Admin', 'men', 'beginner', now(), '0b0b0b01-0000-0000-0000-00000000b001');
insert into public.admins (id, auth_user_id, display_name, created_at)
  values ('ad_fdl', '0b0b0b01-0000-0000-0000-00000000b001', 'Admin', now());
insert into public.coaches (id, name, bio, is_active) values ('co_fdl', 'Coach', 'b', true);

-- The privilege facts that made the original trigger unusable.
select ok(not has_schema_privilege('authenticated', 'tpa', 'usage'),
  'authenticated holds NO usage on schema tpa — unchanged, and why the definer is required');
select ok(not has_schema_privilege('anon', 'tpa', 'usage'),
  'anon holds no usage on schema tpa either');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tpa' and p.proname = 'fill_default_location'),
  true, 'fill_default_location is SECURITY DEFINER');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b0b0b01-0000-0000-0000-00000000b001"}', true);

-- The three inserts the admin makes. Each omits location_id, as a pre-1.4
-- bundle does, and each must land at the default branch rather than raise.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level)
     values ('sl_fdl', 'co_fdl', now() + interval '2 days', now() + interval '2 days 1 hour',
             'group', 4, 'published', 'men', 'beginner') $$,
  'an ADMIN can insert a session_slot with no location_id (this raised 42501 before 064)');
select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, is_active, gender, level)
     values ('at_fdl', 'co_fdl', 1, '17:00', '18:00', 'group', 4, true, 'men', 'beginner') $$,
  'an ADMIN can insert an availability_template with no location_id');
select lives_ok(
  $$ insert into public.packages (id, training_type, session_count, price, name, is_active)
     values ('pk_fdl', 'group', 4, 100000, 'Four', true) $$,
  'an ADMIN can insert a package with no location_id');
reset role;

select is((select location_id from public.session_slots where id = 'sl_fdl'), 'loc_oro_plaza',
  'and the slot landed at the default branch');
select is((select location_id from public.availability_templates where id = 'at_fdl'), 'loc_oro_plaza',
  'and so did the template');

select * from finish();
rollback;
