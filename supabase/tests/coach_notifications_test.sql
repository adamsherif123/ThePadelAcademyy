-- ============================================================================
-- Coach mode phase 4 — the coach's booking alert and 30-minute reminder (pgTAP).
--
-- Two claims carry this phase, and both are about the RECIPIENT rather than the
-- message: the right coach account is found from the slot, and a coach record with
-- no linked login is a clean no-op that never costs the players their own
-- notifications. The reminder additionally rides the EXISTING stamp, so the coach
-- inherits the players' exactly-once guarantee rather than getting a second one.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(28);

insert into auth.users (id) values
  ('0e0e0e01-0000-0000-0000-00000000e001'),   -- the linked coach's login
  ('0e0e0e02-0000-0000-0000-00000000e002'),   -- a booking player
  ('0e0e0e03-0000-0000-0000-00000000e003');   -- a second booking player

insert into public.coaches (id, name, bio, is_active) values
  ('co_linked',   'Linked Coach',   'b', true),
  ('co_unlinked', 'Unlinked Coach', 'b', true);   -- exists in the admin, no login

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, coach_id) values
  ('pl_thecoach', '+201900030001', 'Coach Karim', 'men', 'beginner', now(), '0e0e0e01-0000-0000-0000-00000000e001', 'co_linked'),
  ('pl_booker',   '+201900030002', 'Mona Player', 'ladies', 'beginner', now(), '0e0e0e02-0000-0000-0000-00000000e002', null),
  ('pl_second',   '+201900030003', 'Sara Player', 'ladies', 'beginner', now(), '0e0e0e03-0000-0000-0000-00000000e003', null);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_booker', 'pl_booker', 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now()),
  ('cb_second', 'pl_second', 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now());

-- Booking targets: one on the linked coach, one on the unlinked coach, one full.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_cb_linked',   'co_linked',   now()+interval '2 days', now()+interval '2 days 1 hour', 'group', 4, 0, 'ladies', 'beginner', 'published'),
  ('sl_cb_unlinked', 'co_unlinked', now()+interval '2 days', now()+interval '2 days 1 hour', 'group', 4, 0, 'ladies', 'beginner', 'published'),
  ('sl_cb_full',     'co_linked',   now()+interval '3 days', now()+interval '3 days 1 hour', 'group', 1, 1, 'ladies', 'beginner', 'published'),
  -- Reminder targets, 30 minutes out.
  ('sl_rm_linked',   'co_linked',   now()+interval '30 minutes', now()+interval '90 minutes', 'group', 4, 1, 'ladies', 'beginner', 'published'),
  ('sl_rm_unlinked', 'co_unlinked', now()+interval '30 minutes', now()+interval '90 minutes', 'group', 4, 1, 'ladies', 'beginner', 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at) values
  ('bk_rm_1', 'sl_rm_linked',   'pl_booker', 'cb_booker', 'booked', now(), null),
  ('bk_rm_2', 'sl_rm_unlinked', 'pl_second', 'cb_second', 'booked', now(), null);

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING ALERT — a linked coach
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e0e0e02-0000-0000-0000-00000000e002","role":"authenticated"}', true);
select is(public.book_slot('sl_cb_linked', null)->>'ok', 'true', 'book_slot still succeeds (the alert is additive)');
reset role;

select is(
  (select count(*)::int from public.notifications where type = 'coach_booking_alert'),
  1, 'exactly ONE coach_booking_alert is emitted');
select is(
  (select player_id from public.notifications where type = 'coach_booking_alert'),
  'pl_thecoach', 'it goes to the LOGIN linked to the slot''s coach record');
select is(
  (select title from public.notifications where type = 'coach_booking_alert'),
  'New booking', 'the title reads "New booking"');
select is(
  (select body from public.notifications where type = 'coach_booking_alert'),
  'Mona Player booked your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_cb_linked') || '.',
  'the body names the booker, the type and the Cairo day/time');
select is(
  (select slot_id from public.notifications where type = 'coach_booking_alert'),
  'sl_cb_linked', 'it carries the slot, so tapping it opens that session in the coach app');

-- The booker's own confirmation still fires, and the two never land on one person.
select is(
  (select count(*)::int from public.notifications where type = 'booking_confirmation'),
  1, 'the booker still gets their booking_confirmation');
select is(
  (select player_id from public.notifications where type = 'booking_confirmation'),
  'pl_booker', '…addressed to the booker, not the coach');
select is(
  (select count(*)::int from public.notifications
    where player_id = 'pl_thecoach' and type = 'booking_confirmation'),
  0, 'the coach never receives the booker''s confirmation');
select is(
  (select count(*)::int from public.notifications
    where player_id = 'pl_booker' and type = 'coach_booking_alert'),
  0, 'and the booker never receives the coach''s alert');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING ALERT — a coach with NO linked login
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e0e0e03-0000-0000-0000-00000000e003","role":"authenticated"}', true);
select is(public.book_slot('sl_cb_unlinked', null)->>'ok', 'true',
  'a booking on an UNLINKED coach''s session still succeeds — the alert is best-effort, never a gate');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'coach_booking_alert'),
  0, 'and no coach alert is emitted — there is simply nobody to notify');
select is(
  (select count(*)::int from public.notifications where type = 'booking_confirmation'),
  1, 'the booker''s own confirmation is unaffected by the coach being unlinked');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING ALERT — a REJECTED booking alerts nobody
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0e0e0e02-0000-0000-0000-00000000e002","role":"authenticated"}', true);
select is(public.book_slot('sl_cb_full', null)->>'reason', 'slot_full',
  'a full slot is still rejected, unchanged');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'coach_booking_alert'),
  0, 'a REJECTED booking emits no coach alert — the emit is in the success branch only');

-- ════════════════════════════════════════════════════════════════════════════
-- REMINDER — the coach rides the SAME pass and the SAME stamp
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
select is(tpa.send_session_reminders(), 2, 'both in-window slots are processed in one pass');

select is(
  (select count(*)::int from public.notifications where type = 'coach_session_reminder'),
  1, 'exactly one coach_session_reminder — only the LINKED coach has anyone to tell');
select is(
  (select player_id from public.notifications where type = 'coach_session_reminder'),
  'pl_thecoach', 'it goes to the coach''s own login');
select is(
  (select slot_id from public.notifications where type = 'coach_session_reminder'),
  'sl_rm_linked', '…for their own session');
select is(
  (select body from public.notifications where type = 'coach_session_reminder'),
  'You''re teaching a Group session in 30 minutes — '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_rm_linked') || '.',
  'the body is written from the COACH''s side — "you''re teaching", not "your session starts"');
select is(
  (select count(*)::int from public.notifications where type = 'coach_session_reminder' and slot_id = 'sl_rm_unlinked'),
  0, 'the unlinked coach''s slot produces no coach reminder');

-- The players' reminders are untouched by any of it.
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder'),
  2, 'both booked players are still reminded — including on the unlinked coach''s slot');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and player_id = 'pl_second'),
  1, 'the player on the UNLINKED coach''s session is reminded regardless');

-- ════════════════════════════════════════════════════════════════════════════
-- REMINDER — one stamp covers every recipient
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.send_session_reminders(), 0, 'a second run finds nothing — the shared reminded_at claimed both slots');
select is(
  (select count(*)::int from public.notifications where type = 'coach_session_reminder'),
  1, 'the coach is NOT reminded twice — they inherit the players'' exactly-once guarantee');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder'),
  2, 'and the players are not reminded twice either');
select isnt(
  (select reminded_at from public.session_slots where id = 'sl_rm_linked'),
  null, 'the ONE stamp that covers both the players and the coach is set');

-- ════════════════════════════════════════════════════════════════════════════
-- The constraint still guards the column
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.notifications (id, player_id, type, title, body, created_at)
       values ('nt_bad3', 'pl_thecoach', 'coach_nonsense', 't', 'b', now()) $$,
  '23514', null, 'notifications_type_check still rejects an unknown type');

select * from finish();
rollback;
