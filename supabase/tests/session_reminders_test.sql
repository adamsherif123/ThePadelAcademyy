-- ============================================================================
-- Session reminders (pg_cron) + the booker's own confirmation (pgTAP).
--
-- Two new notification types, proved on the two properties that matter:
--   booking_confirmation — fires on book_slot's SUCCESS path only, to the booker
--     alone, alongside (never instead of) the existing owner_booking and
--     session_confirmed emits.
--   session_reminder     — fires EXACTLY ONCE per slot however many times the cron
--     runs, only for slots inside the window, only to players still holding an
--     active booking.
--
-- The cron SCHEDULE is not exercised here (that is pg_cron's job, not ours); what
-- is exercised is the function the schedule calls, including being called twice.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(32);

-- ── seed as postgres (RLS bypassed) ─────────────────────────────────────────
insert into auth.users (id) values
  ('0eeeeeee-0000-0000-0000-00000000000e'),   -- the booker
  ('0fffffff-0000-0000-0000-00000000000f'),   -- a second player on the same slot
  ('01111111-0000-0000-0000-000000000011');   -- a player who cancels

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_book', '+201900009001', 'Booker One', 'men', 'beginner', now(), '0eeeeeee-0000-0000-0000-00000000000e'),
  ('pl_mate', '+201900009002', 'Mate Two',   'men', 'beginner', now(), '0fffffff-0000-0000-0000-00000000000f'),
  ('pl_quit', '+201900009003', 'Quit Three', 'men', 'beginner', now(), '01111111-0000-0000-0000-000000000011');

-- A coach cannot hold two overlapping PUBLISHED slots (session_slots_coach_no_overlap),
-- and most of the fixture below sits in the same half hour — so each concurrent slot
-- gets its own coach. Only sl_soon and sl_book (tomorrow) share Nour, and only their
-- messages are asserted character-exact.
insert into public.coaches (id, name, bio, is_active) values
  ('co_nour', 'Nour Hassan', 'b', true),
  ('co_alfa', 'Alfa Coach',  'b', true),
  ('co_beta', 'Beta Coach',  'b', true),
  ('co_gama', 'Gama Coach',  'b', true);

-- sl_soon  — 30 minutes out, inside the window.
-- sl_later — 3 hours out, outside it.
-- sl_done  — 30 minutes out but already reminded.
-- sl_dead  — 30 minutes out but cancelled, so not a session anyone is owed a ping for.
-- sl_past  — already started.
-- sl_book  — tomorrow, the one book_slot is called against.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, reminded_at) values
  ('sl_soon',  'co_nour', now()+interval '30 minutes', now()+interval '90 minutes', 'group', 4, 2, 'men', 'beginner', 'published', null),
  ('sl_later', 'co_alfa', now()+interval '3 hours',    now()+interval '4 hours',    'group', 4, 1, 'men', 'beginner', 'published', null),
  ('sl_done',  'co_beta', now()+interval '30 minutes', now()+interval '90 minutes', 'group', 4, 1, 'men', 'beginner', 'published', now()),
  ('sl_dead',  'co_nour', now()+interval '30 minutes', now()+interval '90 minutes', 'group', 4, 1, 'men', 'beginner', 'cancelled', null),
  ('sl_past',  'co_gama', now()-interval '10 minutes', now()+interval '50 minutes', 'group', 4, 1, 'men', 'beginner', 'published', null),
  ('sl_book',  'co_nour', now()+interval '1 day',      now()+interval '1 day 1 hour','group', 4, 0, 'men', 'beginner', 'published', null);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_book', 'pl_book', 'signup_grant', null, 'group', 5, 5, now()+interval '30 day', now()),
  ('cb_mate', 'pl_mate', 'signup_grant', null, 'group', 5, 5, now()+interval '30 day', now()),
  ('cb_quit', 'pl_quit', 'signup_grant', null, 'group', 5, 5, now()+interval '30 day', now());

-- sl_soon: two live bookings and one cancelled one.
-- Every other in-window slot gets a live booking too, so that when it is NOT
-- reminded the reason is the slot's own state and never "nobody was booked".
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at) values
  ('bk_s1', 'sl_soon',  'pl_book', 'cb_book', 'booked',    now(), null),
  ('bk_s2', 'sl_soon',  'pl_mate', 'cb_mate', 'booked',    now(), null),
  ('bk_s3', 'sl_soon',  'pl_quit', 'cb_quit', 'cancelled', now(), now()),
  ('bk_l1', 'sl_later', 'pl_book', 'cb_book', 'booked',    now(), null),
  ('bk_d1', 'sl_done',  'pl_book', 'cb_book', 'booked',    now(), null),
  ('bk_x1', 'sl_dead',  'pl_book', 'cb_book', 'booked',    now(), null),
  ('bk_p1', 'sl_past',  'pl_book', 'cb_book', 'booked',    now(), null);

-- ════════════════════════════════════════════════════════════════════════════
-- The column the whole idempotency argument rests on
-- ════════════════════════════════════════════════════════════════════════════
select has_column('public', 'session_slots', 'reminded_at', 'session_slots.reminded_at exists');
select col_is_null('public', 'session_slots', 'reminded_at', 'reminded_at is nullable — null means "not yet reminded"');

-- ════════════════════════════════════════════════════════════════════════════
-- REMINDERS — run 1
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.send_session_reminders(), 1, 'exactly ONE slot is in the window (sl_soon); the other four are excluded');

select is(
  (select count(*)::int from public.notifications where type = 'session_reminder'),
  2, 'both players holding a LIVE booking on sl_soon are reminded — one row each');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and player_id = 'pl_book'),
  1, 'the booker gets exactly one');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and player_id = 'pl_quit'),
  0, 'a CANCELLED booking is not reminded');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and slot_id <> 'sl_soon'),
  0, 'no reminder is emitted for any slot outside the window');

select isnt(
  (select reminded_at from public.session_slots where id = 'sl_soon'),
  null, 'sl_soon is stamped reminded_at');
select is(
  (select reminded_at from public.session_slots where id = 'sl_later'),
  null, 'a slot outside the window is left unstamped');
select is(
  (select reminded_at from public.session_slots where id = 'sl_past'),
  null, 'a slot that has already STARTED is never reminded — it can only look forward');
select is(
  (select reminded_at from public.session_slots where id = 'sl_dead'),
  null, 'a CANCELLED slot is never reminded');

-- The exact rendered message, built here from the same helpers so the assertion is
-- timezone-independent but still character-exact.
select is(
  (select distinct body from public.notifications where type = 'session_reminder'),
  'Your Group session starts in 30 minutes — '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_soon')
    || ' with Nour.',
  'the reminder body reads: "Your Group session starts in 30 minutes — <time> with Nour."');
select is(
  (select distinct title from public.notifications where type = 'session_reminder'),
  'Starting soon', 'the reminder title is "Starting soon"');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and booking_id is not null),
  2, 'each reminder carries the recipient''s own booking id');

-- ════════════════════════════════════════════════════════════════════════════
-- REMINDERS — run 2: the idempotency claim
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.send_session_reminders(), 0, 'a second run finds nothing — the stamp took sl_soon out of the window');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder'),
  2, 'and emits no second reminder: the cron can run every 5 minutes forever, each slot reminds ONCE');

-- A third run, to make the point that this holds however many times it fires.
select is(tpa.send_session_reminders(), 0, 'a third run is still a no-op');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder'),
  2, 'still two reminders in total');

-- An unstamped slot that enters the window later IS picked up — the stamp is the only
-- thing that suppresses a reminder, not the fact that a run has happened before.
update public.session_slots set starts_at = now()+interval '20 minutes',
                                ends_at   = now()+interval '80 minutes'
  where id = 'sl_later';
select is(tpa.send_session_reminders(), 1, 'a slot that moves INTO the window on a later run is reminded then');
select is(
  (select count(*)::int from public.notifications where type = 'session_reminder' and slot_id = 'sl_later'),
  1, 'and its booked player gets exactly one');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING CONFIRMATION — the success path
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0eeeeeee-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select is(public.book_slot('sl_book', null)->>'ok', 'true', 'book_slot still succeeds (the confirmation is additive)');
reset role;

select is(
  (select count(*)::int from public.notifications where type = 'booking_confirmation'),
  1, 'exactly one booking_confirmation is emitted');
select is(
  (select player_id from public.notifications where type = 'booking_confirmation'),
  'pl_book', 'it goes to the BOOKER, and to nobody else');
select is(
  (select title from public.notifications where type = 'booking_confirmation'),
  'You''re booked!', 'the title reads "You''re booked!"');
select is(
  (select body from public.notifications where type = 'booking_confirmation'),
  'Your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_book')
    || ' with Nour is booked.',
  'the body reads: "Your Group session on <when> with Nour is booked."');
select is(
  (select slot_id from public.notifications where type = 'booking_confirmation'),
  'sl_book', 'it carries the slot, so tapping it focuses that session');
select isnt(
  (select booking_id from public.notifications where type = 'booking_confirmation'),
  null, 'and the booking it confirms');

-- The pre-existing emits are untouched by the addition.
select is(
  (select count(*)::int from public.notifications where type = 'owner_booking'),
  0, 'owner_booking still fires only to flagged owners — there are none in this fixture');
select is(
  (select count(*)::int from public.notifications where type = 'session_confirmed'),
  0, 'session_confirmed does not fire on a slot that is not yet full — unchanged');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING CONFIRMATION — a REJECTED booking confirms nothing
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0eeeeeee-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select is(public.book_slot('sl_book', null)->>'reason', 'already_booked',
  'a second booking on the same slot is still rejected, unchanged');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'booking_confirmation'),
  0, 'a REJECTED booking emits NO confirmation — only the success branch notifies');

-- ════════════════════════════════════════════════════════════════════════════
-- The constraint still guards the column
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.notifications (id, player_id, type, title, body, created_at)
       values ('nt_bad2', 'pl_book', 'not_a_real_type', 't', 'b', now()) $$,
  '23514', null, 'notifications_type_check still rejects an unknown type');

select * from finish();
rollback;
