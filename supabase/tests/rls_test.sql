-- ============================================================================
-- S5 + S5.1 — RLS + constraint proof harness (pgTAP).
--
-- Run with:  supabase test db
-- Impersonation: seed as postgres (bypasses RLS), then `set local role` +
-- `request.jwt.claims` so auth.uid() returns a real player's auth_user_id.
-- Whole file runs in one transaction and is rolled back.
-- ============================================================================
begin;
select plan(61);

-- ── seed (as postgres / superuser: RLS bypassed, constraints still apply) ────
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_admin) values
  ('pl_A',     '+201000000001', 'Ali', 'men',    'beginner',     now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('pl_B',     '+201000000002', 'Bea', 'ladies', 'intermediate', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false),
  ('pl_admin', '+201000000003', 'Adm', 'men',    'beginner',     now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);

insert into public.coaches (id, name, bio, photo_url, is_active) values
  ('co_active',   'Coach Active',   'bio', null, true),
  ('co_inactive', 'Coach Inactive', 'bio', null, false),
  ('co_x',        'Coach X',        'bio', null, true);   -- used by the exclusion tests

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_active',   'trial', 2, 35000,  'Trial Pack', true),
  ('pk_inactive', 'group', 8, 280000, 'Old Group',  false);

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, template_id) values
  ('sl_pub',    'co_active', now() + interval '1 day', now() + interval '1 day 1 hour', 'trial', 4, 1, null, null, 'published', null),
  ('sl_cancel', 'co_active', now() + interval '2 day', now() + interval '2 day 1 hour', 'trial', 4, 0, null, null, 'cancelled', null);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note) values
  ('cb_A', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now(), null),
  ('cb_B', 'pl_B', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now(), null);

insert into public.purchases (id, player_id, package_id, status, amount, created_at, gateway_order_id, gateway_transaction_id) values
  ('pu_A', 'pl_A', 'pk_active', 'pending', 35000, now(), null, null),
  ('pu_B', 'pl_B', 'pk_active', 'pending', 35000, now(), null, null);

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at) values
  ('bk_A', 'sl_pub', 'pl_A', 'cb_A', 'booked', now(), null);

-- Templates: two active (weekdays 0 and 3 → the open days), one inactive.
insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active) values
  ('at_active1',  'co_active', 0, '18:00', '20:00', 'trial',      4, null, null, true),
  ('at_active2',  'co_active', 3, '19:00', '20:30', 'individual', 1, null, null, true),
  ('at_inactive', 'co_active', 5, '18:00', '19:00', 'trial',      4, null, null, false);

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- Cross-player read isolation.
select is((select count(*)::int from public.credit_batches where player_id = 'pl_B'), 0, 'A cannot read B''s credit batches');
select is((select count(*)::int from public.bookings       where player_id = 'pl_B'), 0, 'A cannot read B''s bookings');
select is((select count(*)::int from public.purchases      where player_id = 'pl_B'), 0, 'A cannot read B''s purchases');
select is((select count(*)::int from public.credit_batches where player_id = 'pl_A'), 1, 'A can read their own credit batches');

-- Purchases: pending-only insert surface.
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at)
     values ('pu_A_new', 'pl_A', 'pk_active', 'pending', 35000, now()) $$,
  'A can insert a pending purchase for themselves');
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at)
     values ('pu_A_bad', 'pl_A', 'pk_active', 'succeeded', 35000, now()) $$,
  '42501', null, 'A cannot insert a succeeded purchase (RLS)');
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at)
     values ('pu_forB', 'pl_B', 'pk_active', 'pending', 35000, now()) $$,
  '42501', null, 'A cannot insert a purchase on B''s behalf (RLS)');
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at)
     values ('pu_A_amt', 'pl_A', 'pk_active', 'pending', 1, now()) $$,
  '42501', null, 'A cannot insert a purchase with a tampered amount (RLS amount pin)');

-- credit_batches: zero client write surface.
select throws_ok(
  $$ update public.credit_batches set quantity_remaining = 999 where id = 'cb_A' $$,
  '42501', null, 'A cannot update any credit_batches row, including their own');

-- players: cannot self-promote; can edit own profile; cannot touch others.
select throws_ok(
  $$ update public.players set is_admin = true where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501', null, 'A cannot set is_admin on themselves (column GRANT)');
select lives_ok(
  $$ update public.players set name = 'Ali Renamed' where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'A can update their own name (positive control)');
with u as (
  update public.players set name = 'hacked'
  where auth_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid returning 1)
select is((select count(*)::int from u), 0, 'A''s update targeting B''s row affects 0 rows (RLS USING)');

-- bookings: no direct client insert.
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at)
     values ('bk_hack', 'sl_pub', 'pl_A', 'cb_A', 'booked', now()) $$,
  '42501', null, 'A cannot insert a booking directly');

-- Public reads: published slot / active coach / active package only.
select is((select count(*)::int from public.session_slots where id = 'sl_pub'),    1, 'A can read a published slot');
select is((select count(*)::int from public.session_slots where id = 'sl_cancel'), 0, 'A cannot read a cancelled slot');
select is((select count(*)::int from public.coaches where id = 'co_active'),       1, 'A can read an active coach');
select is((select count(*)::int from public.coaches where id = 'co_inactive'),     0, 'A cannot read an inactive coach');
select is((select count(*)::int from public.packages where id = 'pk_active'),      1, 'A can read an active package');
select is((select count(*)::int from public.packages where id = 'pk_inactive'),    0, 'A cannot read an inactive package');

-- S5.1 TASK 2 — a player CAN read active templates and derive the open weekdays.
select is((select count(*)::int from public.availability_templates), 2, 'A can read active templates (both active ones)');
select is((select count(*)::int from public.availability_templates where id = 'at_inactive'), 0, 'A cannot read an inactive template');
select is(
  (select array_agg(distinct weekday order by weekday) from public.availability_templates),
  array[0, 3]::smallint[],
  'open-weekday derivation works for a non-admin (distinct active weekdays = {0,3})');

-- S5.1 TASK 4 — the amount pin is load-bearing: an inactive package is invisible
-- to the player, so the RLS-filtered price subselect is NULL and the purchase is
-- denied EVEN WITH the correct amount. This is the proof the owner asked for.
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at)
     values ('pu_hidden', 'pl_A', 'pk_inactive', 'pending', 280000, now()) $$,
  '42501', null, 'A cannot purchase an INACTIVE package even with the correct amount (amount pin)');

-- S5.1 TASK 3 — a player cannot perform any admin write.
select throws_ok(
  $$ insert into public.coaches (id, name, bio, is_active) values ('co_hack', 'X', 'x', true) $$,
  '42501', null, 'A cannot insert a coach (admin-only)');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sl_hack', 'co_active', now() + interval '9 day', now() + interval '9 day 1 hour', 'trial', 4, 'published') $$,
  '42501', null, 'A cannot insert a session_slot (admin-only)');
with u as (
  update public.coaches set name = 'x' where id = 'co_active' returning 1)
select is((select count(*)::int from u), 0, 'A''s update of a coach affects 0 rows (admin-only)');
with u as (
  update public.session_slots set capacity = 9 where id = 'sl_pub' returning 1)
select is((select count(*)::int from u), 0, 'A''s update of a session_slot affects 0 rows (admin-only)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN (is_admin = true)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

-- Broad reads.
select is((select count(*)::int from public.players),        3, 'admin can read all players');
select is((select count(*)::int from public.credit_batches), 2, 'admin can read all credit batches');
select is((select count(*)::int from public.purchases),      3, 'admin can read all purchases (pu_A, pu_B + the pending A inserted)');
select is((select count(*)::int from public.session_slots),  2, 'admin can read cancelled slots too');
select is((select count(*)::int from public.availability_templates), 3, 'admin can read all templates incl. inactive');

-- Permitted admin writes (plain CRUD).
select lives_ok(
  $$ insert into public.coaches (id, name, bio, is_active) values ('co_new', 'New Coach', 'bio', true) $$,
  'admin can insert a coach');
select lives_ok(
  $$ update public.coaches set is_active = false where id = 'co_new' $$,
  'admin can update a coach');
select lives_ok(
  $$ insert into public.packages (id, training_type, session_count, price, name, is_active)
     values ('pk_new', 'duo', 4, 120000, 'Duo Pack', true) $$,
  'admin can insert a package');
select lives_ok(
  $$ update public.packages set price = 130000 where id = 'pk_new' $$,
  'admin can update a package');
select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity)
     values ('at_tmp', 'co_active', 2, '17:00', '18:00', 'trial', 4) $$,
  'admin can insert a template');
select lives_ok(
  $$ update public.availability_templates set capacity = 6 where id = 'at_tmp' $$,
  'admin can update a template');
select lives_ok(
  $$ delete from public.availability_templates where id = 'at_tmp' $$,
  'admin can delete a template');
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sl_admin', 'co_active', timestamptz '2031-06-01 18:00+02', timestamptz '2031-06-01 19:00+02', 'trial', 4, 'published') $$,
  'admin can insert a one-off session_slot');
select lives_ok(
  $$ update public.session_slots set capacity = 5 where id = 'sl_pub' $$,
  'admin can update an allowed session_slot column (capacity)');

-- Forbidden even for admin: booked_count and money-equivalent tables.
select throws_ok(
  $$ update public.session_slots set booked_count = booked_count + 1 where id = 'sl_pub' $$,
  '42501', null, 'admin CANNOT write booked_count directly (column not granted — RPC only)');
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at)
     values ('bk_admin', 'sl_pub', 'pl_A', 'cb_A', 'booked', now()) $$,
  '42501', null, 'admin CANNOT insert a booking directly (RPC only)');
select throws_ok(
  $$ update public.credit_batches set quantity_remaining = 0 where id = 'cb_A' $$,
  '42501', null, 'admin CANNOT write credit_batches directly (RPC only)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS ANON (no sub in the JWT → auth.uid() is null)
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok($$ select * from public.players $$, '42501', null, 'anon cannot read players (no grant)');
select is((select count(*)::int from public.session_slots where id = 'sl_pub'), 1, 'anon can read a published slot');
select is((select count(*)::int from public.coaches where id = 'co_active'),    1, 'anon can read an active coach');
select is((select count(*)::int from public.packages where id = 'pk_active'),   1, 'anon can read an active package');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS (as postgres — constraints bind everyone, superuser included)
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
     values ('cb_A2', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now()) $$,
  '23505', null, 'partial unique index rejects a second signup grant');
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at)
     values ('bk_dup', 'sl_pub', 'pl_A', 'cb_A', 'booked', now()) $$,
  '23505', null, 'unique(player_id, slot_id) rejects a duplicate booking');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
     values ('sl_grp', 'co_active', now() + interval '3 day', now() + interval '3 day 1 hour', 'group', 4, 0, 'men', null, 'published') $$,
  '23514', null, 'group invariant CHECK rejects a group slot with null level');
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
     values ('cb_bad', 'pl_A', 'purchase', null, 'trial', 2, 2, now() + interval '30 day', now()) $$,
  '23514', null, 'CHECK rejects source=purchase with null purchase_id');
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
     values ('cb_note', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now(), 'why') $$,
  '23514', null, 'CHECK rejects a note on a non-admin_grant batch');
select throws_ok(
  $$ update public.session_slots set booked_count = capacity + 1 where id = 'sl_pub' $$,
  '23514', null, 'CHECK rejects booked_count > capacity');

update public.session_slots set booked_count = capacity where id = 'sl_pub';
with u as (
  update public.session_slots set booked_count = booked_count + 1
  where id = 'sl_pub' and booked_count < capacity returning 1)
select is((select count(*)::int from u), 0, 'guarded increment yields 0 rows when the slot is full (no oversell)');

update public.session_slots set booked_count = 0 where id = 'sl_pub';
with u as (
  update public.session_slots set booked_count = booked_count + 1
  where id = 'sl_pub' and booked_count < capacity returning 1)
select is((select count(*)::int from u), 1, 'guarded increment yields 1 row when a seat is free');

-- S5.1 TASK 1 — coach double-booking exclusion.
-- Base published slot for co_x, 18:00–20:00.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sx_base', 'co_x', timestamptz '2030-01-01 18:00+02', timestamptz '2030-01-01 20:00+02', 'trial', 4, 'published') $$,
  'exclusion: base published slot inserts');
-- Overlapping published slot for the SAME coach (19:00–21:00) is rejected.
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sx_overlap', 'co_x', timestamptz '2030-01-01 19:00+02', timestamptz '2030-01-01 21:00+02', 'trial', 4, 'published') $$,
  '23P01', null, 'exclusion: a coach cannot be double-booked in overlapping published slots');
-- Back-to-back (20:00–22:00) TOUCHES but does not overlap — allowed ([) bound).
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sx_touch', 'co_x', timestamptz '2030-01-01 20:00+02', timestamptz '2030-01-01 22:00+02', 'trial', 4, 'published') $$,
  'exclusion: touching back-to-back slots (20:00 start = prior 20:00 end) are allowed');
-- A DIFFERENT coach at the same time is fine.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sx_other', 'co_active', timestamptz '2030-01-01 18:00+02', timestamptz '2030-01-01 20:00+02', 'trial', 4, 'published') $$,
  'exclusion: a different coach at the same time does not conflict');
-- A CANCELLED slot overlapping the base does not conflict (predicate is published-only).
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status)
     values ('sx_cancel', 'co_x', timestamptz '2030-01-01 18:30+02', timestamptz '2030-01-01 19:30+02', 'trial', 4, 'cancelled') $$,
  'exclusion: a cancelled slot does not block its published replacement');

select * from finish();
rollback;
