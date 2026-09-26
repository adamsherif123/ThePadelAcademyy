-- ============================================================================
-- locations: the table, its privileges, the pin, and the three columns that
-- hang off it (pgTAP).
--
-- The things that must hold:
--   * exactly one default, and no API path can move it or choose an id;
--   * a player reads every location and writes none;
--   * an admin writes the editable columns and nothing else;
--   * nobody deletes;
--   * every row on the three tables has a location, a NULL insert lands at the
--     default (the temporary stale-bundle fallback), and none of them can ever
--     change branch afterwards.
--
-- Privileges are asserted at the PRIVILEGE layer (has_column_privilege), not
-- only by "does a query fail" — for four years the something that failed a
-- query here would have been RLS. See migration 060.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(52);

insert into auth.users (id) values
  ('0e0e0e01-0000-0000-0000-00000000e001'),   -- admin
  ('0e0e0e02-0000-0000-0000-00000000e002');   -- ordinary player

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_loc_adm', '+201900030001', 'Admin Human', 'men', 'beginner', now(), '0e0e0e01-0000-0000-0000-00000000e001'),
  ('pl_loc_p1',  '+201900030002', 'Plain Player','men', 'beginner', now(), '0e0e0e02-0000-0000-0000-00000000e002');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_loc', '0e0e0e01-0000-0000-0000-00000000e001', 'Admin', now());

insert into public.coaches (id, name, bio, is_active) values ('co_loc', 'Coach', 'b', true);

-- A second branch to test against. Inserted as postgres, because the whole
-- point below is that no client role can supply an id.
insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_test_b', 'Branch B', 'Somewhere, Cairo', 'https://maps.google.com/?q=B', 'Daily · 9–5', 1, true, false);

-- ════════════════════════════════════════════════════════════════════════════
-- Shape and the pin
-- ════════════════════════════════════════════════════════════════════════════
select has_table('public', 'locations', 'locations exists');
select has_index('public', 'locations', 'locations_one_default', 'the one-default partial unique index exists');
select is((select count(*)::int from public.locations where is_default), 1, 'exactly one default location');
select is((select id from public.locations where is_default), 'loc_oro_plaza', 'the default is the original branch');
select is(tpa.default_location_id(), 'loc_oro_plaza', 'default_location_id() resolves the pin');
select is(
  (select name || ' | ' || address || ' | ' || hours_text from public.locations where is_default),
  'Oro Plaza Hotel | In front of Family Park, Cairo | Sun – Wed · 5:00 PM – 11:00 PM',
  'the seed matches the mobile ACADEMY constant verbatim');

-- A second default is impossible even for postgres.
select throws_ok(
  $$ update public.locations set is_default = true where id = 'loc_test_b' $$,
  '23505', null, 'a second default violates the partial unique index');

-- ════════════════════════════════════════════════════════════════════════════
-- Privileges: what each role may touch
-- ════════════════════════════════════════════════════════════════════════════
select ok(has_table_privilege('authenticated', 'public.locations', 'select'),
  'authenticated may select locations');
select ok(not has_table_privilege('authenticated', 'public.locations', 'delete'),
  'authenticated holds NO delete — a branch is retired, never removed');
select ok(not has_table_privilege('authenticated', 'public.locations', 'truncate'),
  'authenticated holds no truncate either');
select ok(not has_column_privilege('authenticated', 'public.locations', 'id', 'insert'),
  'authenticated cannot write id — the API never chooses a location id');
select ok(not has_column_privilege('authenticated', 'public.locations', 'is_default', 'insert'),
  'authenticated cannot INSERT is_default — the legacy pin is migration-only');
select ok(not has_column_privilege('authenticated', 'public.locations', 'is_default', 'update'),
  'authenticated cannot UPDATE is_default — this is what stops the pin moving under a stale binary');
select ok(has_column_privilege('authenticated', 'public.locations', 'name', 'update'),
  'authenticated may update name');
select ok(has_column_privilege('authenticated', 'public.locations', 'is_active', 'update'),
  'authenticated may update is_active (the guard RPC is the intended path)');
select ok(not has_table_privilege('anon', 'public.locations', 'select'),
  'anon holds nothing on locations');
select ok(not has_table_privilege('anon', 'public.locations', 'insert'),
  'anon cannot insert locations');

-- ════════════════════════════════════════════════════════════════════════════
-- A player: reads everything, writes nothing
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e02-0000-0000-0000-00000000e002"}';

select is((select count(*)::int from public.locations), 2,
  'a player reads every location, active or not');
select throws_ok(
  $$ insert into public.locations (name, address, maps_url, hours_text) values ('X','Y','https://a.b','h') $$,
  '42501', null, 'a player inserting a location is refused by RLS');
-- NOT throws_ok: RLS's USING clause filters the row out of the UPDATE's scope,
-- so the statement succeeds having changed nothing. "It did not raise" is not
-- the same as "it worked", and the row is what proves it.
select lives_ok(
  $$ update public.locations set name = 'hacked' where id = 'loc_test_b' $$,
  'a player''s update raises nothing — RLS removes the row from its scope');
select is((select name from public.locations where id = 'loc_test_b'), 'Branch B',
  'and the location is untouched — the player changed zero rows');
select throws_ok(
  $$ delete from public.locations where id = 'loc_test_b' $$,
  '42501', null, 'a player cannot delete a location');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- An admin: the editable columns, and only those
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e01-0000-0000-0000-00000000e001"}';

select lives_ok(
  $$ insert into public.locations (name, address, maps_url, hours_text, sort_order)
     values ('Branch C', 'Third place', 'https://maps.google.com/?q=C', 'Mon – Fri', 2) $$,
  'an admin creates a location without supplying an id');
select lives_ok(
  $$ update public.locations set name = 'Branch B renamed' where id = 'loc_test_b' $$,
  'an admin edits an editable column');
select throws_ok(
  $$ insert into public.locations (id, name, address, maps_url, hours_text)
     values ('loc_chosen','X','Y','https://a.b','h') $$,
  '42501', null, 'an admin CANNOT choose an id — refused at the privilege layer, before RLS');
select throws_ok(
  $$ update public.locations set is_default = true where id = 'loc_test_b' $$,
  '42501', null, 'an admin CANNOT move the default — the pin is not an API-writable value');
select throws_ok(
  $$ delete from public.locations where id = 'loc_test_b' $$,
  '42501', null, 'an admin cannot delete a location either');
reset role;

select is((select id ~ '^loc_[0-9a-f-]{36}$' from public.locations where name = 'Branch C'), true,
  'the generated id carries the loc_ prefix');

-- ════════════════════════════════════════════════════════════════════════════
-- The three columns: NOT NULL, the fallback, and immutability
-- ════════════════════════════════════════════════════════════════════════════
select col_not_null('public', 'session_slots', 'location_id', 'session_slots.location_id is NOT NULL');
select col_not_null('public', 'availability_templates', 'location_id', 'availability_templates.location_id is NOT NULL');
select col_not_null('public', 'packages', 'location_id', 'packages.location_id is NOT NULL');
select has_index('public', 'session_slots', 'session_slots_location_starts_idx',
  'the (location_id, starts_at) index exists');
select has_index('public', 'session_slots', 'session_slots_starts_at_idx',
  'the date-only index is KEPT — the admin still scans across branches');

-- The temporary stale-bundle fallback: a NULL insert lands at the default.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level)
  values ('sl_nullloc', 'co_loc', now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 4, 'published', 'men', 'beginner');
select is((select location_id from public.session_slots where id = 'sl_nullloc'), 'loc_oro_plaza',
  'a session_slot inserted WITHOUT location_id lands at the default');

insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, is_active, gender, level)
  values ('at_nullloc', 'co_loc', 1, '17:00', '18:00', 'group', 4, true, 'men', 'beginner');
select is((select location_id from public.availability_templates where id = 'at_nullloc'), 'loc_oro_plaza',
  'an availability_template inserted WITHOUT location_id lands at the default');

insert into public.packages (id, training_type, session_count, price, name, is_active)
  values ('pk_nullloc', 'group', 4, 100000, 'Four group', true);
select is((select location_id from public.packages where id = 'pk_nullloc'), 'loc_oro_plaza',
  'a package inserted WITHOUT location_id lands at the default');

-- Immutability, on all three, as postgres — so it is the TRIGGER being proven,
-- not the grant (a client role would be stopped earlier on session_slots).
select throws_ok(
  $$ update public.session_slots set location_id = 'loc_test_b' where id = 'sl_nullloc' $$,
  'P0001', null, 'a session_slot cannot change branch');
select throws_ok(
  $$ update public.availability_templates set location_id = 'loc_test_b' where id = 'at_nullloc' $$,
  'P0001', null, 'an availability_template cannot change branch');
select throws_ok(
  $$ update public.packages set location_id = 'loc_test_b' where id = 'pk_nullloc' $$,
  'P0001', null, 'a package cannot change branch');
-- An UPDATE that leaves location_id alone must still work.
select lives_ok(
  $$ update public.session_slots set capacity = 3 where id = 'sl_nullloc' $$,
  'an ordinary update on the same row is unaffected');

-- reschedule_session moves the time; it must not be able to move the branch.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reschedule_session'
      and p.prosrc like '%location_id%'),
  0, 'reschedule_session does not mention location_id at all');
select ok(
  not has_column_privilege('authenticated', 'public.session_slots', 'location_id', 'update'),
  'authenticated holds NO update on session_slots.location_id — reschedule cannot move a branch');
select ok(
  has_column_privilege('authenticated', 'public.session_slots', 'location_id', 'insert'),
  'authenticated CAN insert session_slots.location_id (the admin creating a slot)');

-- ════════════════════════════════════════════════════════════════════════════
-- The deactivation guard
-- ════════════════════════════════════════════════════════════════════════════
-- A future published session AT BRANCH B — the thing the guard must see. The
-- slot above is at the default branch and would make has_future_slots pass for
-- entirely the wrong reason.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level, location_id)
  values ('sl_slotb', 'co_loc', now() + interval '3 days', now() + interval '3 days 1 hour',
          'group', 4, 'published', 'men', 'beginner', 'loc_test_b');

create temporary table loc_res (tag text primary key, r jsonb);
grant insert on loc_res to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e02-0000-0000-0000-00000000e002"}';
insert into loc_res values ('player', public.set_location_active('loc_test_b', false));
reset role;
select is((select r ->> 'reason' from loc_res where tag = 'player'), 'not_admin',
  'a player cannot deactivate a location');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e01-0000-0000-0000-00000000e001"}';
insert into loc_res values
  ('missing', public.set_location_active('loc_nope', false)),
  ('default', public.set_location_active('loc_oro_plaza', false)),
  ('slots',   public.set_location_active('loc_test_b', false));
reset role;

select is((select r ->> 'reason' from loc_res where tag = 'missing'), 'location_missing',
  'an unknown location is location_missing');
select is((select r ->> 'reason' from loc_res where tag = 'default'), 'default_location',
  'the default location can never be deactivated');
select is((select r ->> 'reason' from loc_res where tag = 'slots'), 'has_future_slots',
  'a branch with a future published slot is refused');
select is((select r ->> 'slots' from loc_res where tag = 'slots'), '1',
  'the refusal names how many sessions are in the way');

-- Move the slot out of the way (cancel it), leaving only the template.
update public.session_slots set status = 'cancelled' where id = 'sl_slotb';
insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, is_active, gender, level, location_id)
  values ('at_locb', 'co_loc', 2, '17:00', '18:00', 'group', 4, true, 'men', 'beginner', 'loc_test_b');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e01-0000-0000-0000-00000000e001"}';
insert into loc_res values ('tmpls', public.set_location_active('loc_test_b', false));
reset role;
select is((select r ->> 'reason' from loc_res where tag = 'tmpls'), 'has_active_templates',
  'a branch with an active template is refused — it would keep generating slots');

update public.availability_templates set is_active = false where id = 'at_locb';

set local role authenticated;
set local request.jwt.claims = '{"sub":"0e0e0e01-0000-0000-0000-00000000e001"}';
insert into loc_res values ('ok', public.set_location_active('loc_test_b', false));
insert into loc_res values ('again', public.set_location_active('loc_test_b', false));
reset role;
select is((select r ->> 'ok' from loc_res where tag = 'ok'), 'true',
  'with nothing in the way, the branch deactivates');
select is((select is_active from public.locations where id = 'loc_test_b'), false,
  'and the row really is inactive');
select is((select r ->> 'already' from loc_res where tag = 'again'), 'true',
  'calling it twice is idempotent, not an error');

select * from finish();
rollback;
