-- ============================================================================
-- S5 — RLS + constraint proof harness (pgTAP).
--
-- Run with:  supabase test db
-- Every assertion below corresponds to a line in the S5 "PROVE THE POLICIES"
-- checklist, plus a handful of positive controls so a passing run also proves
-- the policies don't over-deny.
--
-- Impersonation model: seed as the superuser (postgres, which bypasses RLS),
-- then `set local role authenticated` + `request.jwt.claims` so auth.uid()
-- returns a real player's auth_user_id — exactly what a signed-in client's JWT
-- produces. anon is impersonated with a claim set that has no `sub`.
-- The whole file runs in one transaction and is rolled back at the end.
-- ============================================================================
begin;
select plan(36);

-- ── seed (as postgres / superuser: RLS bypassed, constraints still apply) ────
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_admin) values
  ('pl_A',     '+201000000001', 'Ali', 'men',    'beginner',     now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('pl_B',     '+201000000002', 'Bea', 'ladies', 'intermediate', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false),
  ('pl_admin', '+201000000003', 'Adm', 'men',    'beginner',     now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);

insert into public.coaches (id, name, bio, photo_url, is_active) values
  ('co_active',   'Coach Active',   'bio', null, true),
  ('co_inactive', 'Coach Inactive', 'bio', null, false);

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

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- Cross-player read isolation (credit_batches / bookings / purchases).
select is(
  (select count(*)::int from public.credit_batches where player_id = 'pl_B'),
  0, 'A cannot read B''s credit batches');
select is(
  (select count(*)::int from public.bookings where player_id = 'pl_B'),
  0, 'A cannot read B''s bookings');
select is(
  (select count(*)::int from public.purchases where player_id = 'pl_B'),
  0, 'A cannot read B''s purchases');

-- Positive control: A *can* read their own wallet.
select is(
  (select count(*)::int from public.credit_batches where player_id = 'pl_A'),
  1, 'A can read their own credit batches');

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
  where auth_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  returning 1)
select is((select count(*)::int from u), 0, 'A''s update targeting B''s row affects 0 rows (RLS USING)');

-- bookings: no direct client insert.
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at)
     values ('bk_hack', 'sl_pub', 'pl_A', 'cb_A', 'booked', now()) $$,
  '42501', null, 'A cannot insert a booking directly');

-- Public reads: visible = published slot / active coach / active package only.
select is((select count(*)::int from public.session_slots where id = 'sl_pub'),    1, 'A can read a published slot');
select is((select count(*)::int from public.session_slots where id = 'sl_cancel'), 0, 'A cannot read a cancelled slot');
select is((select count(*)::int from public.coaches where id = 'co_active'),       1, 'A can read an active coach');
select is((select count(*)::int from public.coaches where id = 'co_inactive'),     0, 'A cannot read an inactive coach');
select is((select count(*)::int from public.packages where id = 'pk_active'),      1, 'A can read an active package');
select is((select count(*)::int from public.packages where id = 'pk_inactive'),    0, 'A cannot read an inactive package');

-- Back-office config is not visible to a player.
select is((select count(*)::int from public.availability_templates), 0, 'A cannot read availability_templates');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN (is_admin = true) — positive controls that the flag broadens reads
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

select is((select count(*)::int from public.players),        3, 'admin can read all players');
select is((select count(*)::int from public.credit_batches), 2, 'admin can read all credit batches');
select is((select count(*)::int from public.purchases),      3, 'admin can read all purchases (pu_A, pu_B + the pending A inserted)');
select is((select count(*)::int from public.session_slots),  2, 'admin can read cancelled slots too');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS ANON (no sub in the JWT → auth.uid() is null)
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select * from public.players $$,
  '42501', null, 'anon cannot read players (no grant)');
select is((select count(*)::int from public.session_slots where id = 'sl_pub'), 1, 'anon can read a published slot');
select is((select count(*)::int from public.coaches where id = 'co_active'),    1, 'anon can read an active coach');
select is((select count(*)::int from public.packages where id = 'pk_active'),   1, 'anon can read an active package');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- CONSTRAINTS (as postgres — constraints bind everyone, superuser included)
-- ════════════════════════════════════════════════════════════════════════════

-- Signup-grant idempotency: a second signup_grant for the same player is rejected.
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
     values ('cb_A2', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now()) $$,
  '23505', null, 'partial unique index rejects a second signup grant');

-- One booking per (player, slot).
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at)
     values ('bk_dup', 'sl_pub', 'pl_A', 'cb_A', 'booked', now()) $$,
  '23505', null, 'unique(player_id, slot_id) rejects a duplicate booking');

-- Group invariant: a group slot with a null level is rejected.
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
     values ('sl_grp', 'co_active', now() + interval '3 day', now() + interval '3 day 1 hour', 'group', 4, 0, 'men', null, 'published') $$,
  '23514', null, 'group invariant CHECK rejects a group slot with null level');

-- credit_batches purchase-link invariant: purchase source needs a purchase_id.
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
     values ('cb_bad', 'pl_A', 'purchase', null, 'trial', 2, 2, now() + interval '30 day', now()) $$,
  '23514', null, 'CHECK rejects source=purchase with null purchase_id');

-- note is only allowed on admin_grant.
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
     values ('cb_note', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now() + interval '30 day', now(), 'why') $$,
  '23514', null, 'CHECK rejects a note on a non-admin_grant batch');

-- booked_count can never exceed capacity.
select throws_ok(
  $$ update public.session_slots set booked_count = capacity + 1 where id = 'sl_pub' $$,
  '23514', null, 'CHECK rejects booked_count > capacity');

-- Atomic-increment guarantee (the S7 mechanism): the guarded UPDATE affects
-- zero rows when the slot is full, and one row when a seat is free.
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

select * from finish();
rollback;
