-- ============================================================================
-- owner_cancellation — the owners are told when a PLAYER drops out (pgTAP).
--
-- The symmetric half of owner_notifications_test.sql. Proves the emit fires on the
-- player self-cancel only, carries the exact string, excludes the actor, and —
-- the scoping that matters most — that the three ACADEMY-initiated cancel paths
-- (admin removes a player, admin cancels the session, delete-account cascade) emit
-- nothing at all.
--
-- Owners are seeded and flagged here, deliberately NOT the two production ids, so
-- correctness doesn't depend on who the academy currently calls an owner.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(18);

insert into auth.users (id) values
  ('0a1aaaaa-0000-0000-0000-0000000000a1'),   -- owner 1
  ('0b1bbbbb-0000-0000-0000-0000000000b1'),   -- owner 2
  ('0c1ccccc-0000-0000-0000-0000000000c1'),   -- Peter, a plain player
  ('0d1ddddd-0000-0000-0000-0000000000d1'),   -- a second plain player (stays booked)
  ('0e1eeeee-0000-0000-0000-0000000000e1');   -- admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_o1',   '+201900010001', 'Owner One', 'men', 'beginner', now(), '0a1aaaaa-0000-0000-0000-0000000000a1'),
  ('pl_o2',   '+201900010002', 'Owner Two', 'men', 'beginner', now(), '0b1bbbbb-0000-0000-0000-0000000000b1'),
  ('pl_pete', '+201900010003', 'Peter',     'men', 'beginner', now(), '0c1ccccc-0000-0000-0000-0000000000c1'),
  ('pl_stay', '+201900010004', 'Stayer',    'men', 'beginner', now(), '0d1ddddd-0000-0000-0000-0000000000d1');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_c', '0e1eeeee-0000-0000-0000-0000000000e1', 'AdmC', now());

update public.players set is_owner = true where id in ('pl_o1', 'pl_o2');

insert into public.coaches (id, name, bio, is_active) values
  ('co_abd', 'Abdelrahman Sami', 'b', true);

-- A 10:00 PM Cairo session, comfortably outside the cancellation window.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_10pm', 'co_abd',
     ((date_trunc('day', (now() at time zone 'Africa/Cairo')) + interval '3 day 22 hour') at time zone 'Africa/Cairo'),
     ((date_trunc('day', (now() at time zone 'Africa/Cairo')) + interval '3 day 23 hour 30 minute') at time zone 'Africa/Cairo'),
     'group', 4, 0, 'men', 'beginner', 'published'),
  ('sl_adm',  'co_abd', now()+interval '4 day', now()+interval '4 day 1 hour', 'group', 4, 0, 'men', 'beginner', 'published'),
  ('sl_ses',  'co_abd', now()+interval '5 day', now()+interval '5 day 1 hour', 'group', 4, 0, 'men', 'beginner', 'published'),
  ('sl_del',  'co_abd', now()+interval '6 day', now()+interval '6 day 1 hour', 'group', 4, 0, 'men', 'beginner', 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_pete', 'pl_pete', 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now()),
  ('cb_o1',   'pl_o1',   'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now()),
  ('cb_stay', 'pl_stay', 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now());

-- ════════════════════════════════════════════════════════════════════════════
-- A PLAYER cancels their own booking → both owners pinged, exact string
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1ccccc-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(public.book_slot('sl_10pm')->>'ok', 'true', 'Peter books the 10pm session');
reset role;

delete from public.notifications;   -- drop the owner_booking pings from that booking

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1ccccc-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(
  (select public.cancel_booking(b.id)->>'ok' from public.bookings b
    where b.slot_id = 'sl_10pm' and b.player_id = 'pl_pete'),
  'true', 'cancel_booking still succeeds (the ping is additive)');
reset role;

select is(
  (select booked_count from public.session_slots where id = 'sl_10pm'),
  0, 'the seat was actually freed — the guarded cancel logic is unchanged');
select is(
  (select quantity_remaining from public.credit_batches where id = 'cb_pete'),
  9, 'the credit was refunded (outside the 5h window) — refund logic unchanged');
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation'),
  2, 'a player self-cancel pings BOTH owners — one row each');
select is(
  (select distinct body from public.notifications where type = 'owner_cancellation'),
  'Peter cancelled 10pm slot with Abdelrahman',
  'the exact required string: "Peter cancelled 10pm slot with Abdelrahman"');
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation' and slot_id is not null),
  0, 'the ping carries NO slot id — every shipped build would focus Sessions on a slot the owner has no booking on');
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation' and player_id = 'pl_pete'),
  0, 'the cancelling player is not pinged');

-- ════════════════════════════════════════════════════════════════════════════
-- An OWNER cancelling their own booking is not self-pinged
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1aaaaa-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.book_slot('sl_10pm')->>'ok', 'true', 'owner 1 books the session');
reset role;
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1aaaaa-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(
  (select public.cancel_booking(b.id)->>'ok' from public.bookings b
    where b.slot_id = 'sl_10pm' and b.player_id = 'pl_o1' and b.status = 'booked'),
  'true', 'owner 1 cancels their own booking');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation' and player_id = 'pl_o1'),
  0, 'an owner cancelling their OWN booking is never self-pinged');
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation' and player_id = 'pl_o2'),
  1, 'the OTHER owner is still pinged');

-- ════════════════════════════════════════════════════════════════════════════
-- The three ACADEMY-initiated paths emit nothing
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1ccccc-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(public.book_slot('sl_adm')->>'ok', 'true', 'Peter books a session an admin will remove him from');
reset role;
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e1eeeee-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is(
  (select public.remove_booking(b.id, true)->>'ok' from public.bookings b
    where b.slot_id = 'sl_adm' and b.player_id = 'pl_pete'),
  'true', 'an ADMIN removes the player');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation'),
  0, 'remove_booking (the academy did it) pings NO owner');

-- cancel_session — the admin cancels a whole session with a booking on it
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d1ddddd-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is(public.book_slot('sl_ses')->>'ok', 'true', 'Stayer books a session the admin will cancel');
reset role;
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e1eeeee-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is(public.cancel_session('sl_ses')->>'ok', 'true', 'an ADMIN cancels the whole session');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'owner_cancellation'),
  0, 'cancel_session (the academy did it) pings NO owner');

select * from finish();
rollback;
