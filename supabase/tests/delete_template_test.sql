-- ============================================================================
-- Quick fix — delete_template: retire a recurring rule + academy-cancel its
-- FUTURE sessions, reusing cancel_session verbatim (no new refund path).
--
-- Proves: future sessions (booked, manually-confirmed, filled, empty, and one
-- STARTING INSIDE the 3h window) all cancel and refund regardless of state or
-- window; an already-cancelled future slot is skipped, not double-counted;
-- PAST sessions (booked, attended) are completely untouched — no refund, no
-- status change, no notification; the rule is retired (deleted_at set,
-- is_active forced false), never hard-deleted; a second call is a clean
-- idempotent no-op; a non-admin is refused; an unknown template is rejected.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(36);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'), -- admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), -- pl_dt_a
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), -- pl_dt_b
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'), -- pl_dt_c
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'), -- pl_dt_d
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'); -- pl_dt_e (past, attended)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_dt', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_dt_a', '+201900001001', 'DtA', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_dt_b', '+201900001002', 'DtB', 'men', 'beginner', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('pl_dt_c', '+201900001003', 'DtC', 'men', 'beginner', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('pl_dt_d', '+201900001004', 'DtD', 'men', 'beginner', now(), 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  ('pl_dt_e', '+201900001005', 'DtE', 'men', 'beginner', now(), 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

insert into public.coaches (id, name, bio, is_active) values ('co_dt', 'C', 'b', true);

insert into public.availability_templates
  (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active) values
  ('at_dt', 'co_dt', 3, '17:00', '18:30', 'group', 4, 'men', 'beginner', true);

-- Future sessions this rule generated: booked (outside window), manually
-- confirmed, filled-by-derivation, empty (no bookings), starting INSIDE the
-- 3h window (proves academy-cancel refunds regardless), and one already
-- cancelled beforehand (must be skipped, not double-processed).
insert into public.session_slots
  (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, template_id, manually_confirmed_at) values
  ('sl_dt_future_booked',   'co_dt', now()+interval '2 day',    now()+interval '2 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published', 'at_dt', null),
  ('sl_dt_future_manual',   'co_dt', now()+interval '3 day',    now()+interval '3 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published', 'at_dt', now()),
  ('sl_dt_future_filled',   'co_dt', now()+interval '4 day',    now()+interval '4 day 1 hour', 'group', 1, 1, 'men', 'beginner', 'published', 'at_dt', null),
  ('sl_dt_future_empty',    'co_dt', now()+interval '5 day',    now()+interval '5 day 1 hour', 'group', 4, 0, 'men', 'beginner', 'published', 'at_dt', null),
  ('sl_dt_future_soon',     'co_dt', now()+interval '1 hour',   now()+interval '2 hour',       'group', 4, 1, 'men', 'beginner', 'published', 'at_dt', null),
  ('sl_dt_future_alreadyc', 'co_dt', now()+interval '6 day',    now()+interval '6 day 1 hour', 'group', 4, 0, 'men', 'beginner', 'cancelled', 'at_dt', null);

-- Past sessions: must stay byte-identical through the whole test.
insert into public.session_slots
  (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, template_id, manually_confirmed_at) values
  ('sl_dt_past_booked',   'co_dt', now()-interval '2 day', now()-interval '2 day'+interval '1 hour', 'group', 4, 1, 'men', 'beginner', 'published', 'at_dt', null),
  ('sl_dt_past_attended', 'co_dt', now()-interval '3 day', now()-interval '3 day'+interval '1 hour', 'group', 4, 1, 'men', 'beginner', 'published', 'at_dt', null);

insert into public.credit_batches
  (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_dt_a', 'pl_dt_a', 'signup_grant', null, 'group', 4, 3, now()+interval '20 day', now()),
  ('cb_dt_b', 'pl_dt_b', 'signup_grant', null, 'group', 4, 3, now()+interval '20 day', now()),
  ('cb_dt_c', 'pl_dt_c', 'signup_grant', null, 'group', 4, 3, now()+interval '20 day', now()),
  ('cb_dt_d', 'pl_dt_d', 'signup_grant', null, 'group', 4, 3, now()+interval '20 day', now()),
  ('cb_dt_past', 'pl_dt_e', 'signup_grant', null, 'group', 4, 3, now()+interval '20 day', now());

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_dt_future_booked', 'sl_dt_future_booked', 'pl_dt_a', 'cb_dt_a', 'booked', now()),
  ('bk_dt_future_manual', 'sl_dt_future_manual', 'pl_dt_b', 'cb_dt_b', 'booked', now()),
  ('bk_dt_future_filled', 'sl_dt_future_filled', 'pl_dt_c', 'cb_dt_c', 'booked', now()),
  ('bk_dt_future_soon',   'sl_dt_future_soon',   'pl_dt_d', 'cb_dt_d', 'booked', now()),
  ('bk_dt_past_booked',   'sl_dt_past_booked',   'pl_dt_e', 'cb_dt_past', 'booked', now()-interval '3 day'),
  ('bk_dt_past_attended', 'sl_dt_past_attended', 'pl_dt_e', 'cb_dt_past', 'attended', now()-interval '4 day');

-- ════════════════════════════════════════════════════════════════════════════
-- Guards: not_admin, template_missing
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.delete_template('at_dt')->>'reason', 'not_admin', 'a player cannot delete a recurring rule');

select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.delete_template('at_nope')->>'reason', 'template_missing', 'an unknown template is rejected');

-- ════════════════════════════════════════════════════════════════════════════
-- The real call — captured ONCE (a second call is its own idempotency test
-- below, not an accident of re-reading this one).
-- ════════════════════════════════════════════════════════════════════════════
create temporary table tmp_dt_first as select public.delete_template('at_dt') as v;
select is((select v->>'ok' from tmp_dt_first), 'true', 'delete_template succeeds');
select is((select v->>'already_deleted' from tmp_dt_first), 'false', 'first call: not already deleted');
select is((select v->>'cancelled_count' from tmp_dt_first), '5', 'cancels exactly the 5 real future sessions (booked/manual/filled/empty/soon) — the already-cancelled one is not recounted');
drop table tmp_dt_first;

-- notifications RLS scopes SELECT to the owning player only (no admin OR
-- clause — there's no reason for the admin app to read a player's inbox) —
-- read the resulting state as postgres from here on, same as every other
-- post-mutation assertion below.
reset role;

-- ── future sessions: all cancelled, all refunded, regardless of state ──
select is((select status from public.session_slots where id='sl_dt_future_booked'), 'cancelled', 'future booked slot cancelled');
select is((select booked_count from public.session_slots where id='sl_dt_future_booked'), 0, 'future booked slot emptied');
select is((select status from public.bookings where id='bk_dt_future_booked'), 'cancelled', 'future booking cancelled');
select is((select quantity_remaining from public.credit_batches where id='cb_dt_a'), 4, 'future booking refunded to its ORIGINAL batch (3→4)');
select ok((select expires_at from public.credit_batches where id='cb_dt_a') > now()+interval '19 day', 'refund did NOT touch the original expiry (still ~20 days out)');
select isnt((select id from public.notifications where player_id='pl_dt_a' and slot_id='sl_dt_future_booked' and type='session_cancelled'), null, 'the refunded player was notified (session_cancelled)');

select is((select status from public.session_slots where id='sl_dt_future_manual'), 'cancelled', 'a MANUALLY CONFIRMED future slot still cancels');
select is((select status from public.bookings where id='bk_dt_future_manual'), 'cancelled', 'its booking still cancels');
select is((select quantity_remaining from public.credit_batches where id='cb_dt_b'), 4, 'its credit is still refunded');

select is((select status from public.session_slots where id='sl_dt_future_filled'), 'cancelled', 'a FILLED (confirmed-by-derivation) future slot still cancels');
select is((select status from public.bookings where id='bk_dt_future_filled'), 'cancelled', 'its booking still cancels');
select is((select quantity_remaining from public.credit_batches where id='cb_dt_c'), 4, 'its credit is still refunded');

select is((select status from public.session_slots where id='sl_dt_future_empty'), 'cancelled', 'an EMPTY future slot (no bookings) still retires — the rule is gone, nothing should remain bookable under it');

select is((select status from public.session_slots where id='sl_dt_future_soon'), 'cancelled', 'a future slot starting INSIDE the 3h window still cancels (academy cancellation ignores the window)');
select is((select status from public.bookings where id='bk_dt_future_soon'), 'cancelled', 'its booking cancels');
select is((select quantity_remaining from public.credit_batches where id='cb_dt_d'), 4, 'refunded regardless of the window — the locked rule (never a forfeit on an academy cancellation)');

select is((select status from public.session_slots where id='sl_dt_future_alreadyc'), 'cancelled', 'the pre-cancelled future slot stays cancelled (untouched, not double-processed)');

-- ── past sessions: completely untouched ──
select is((select status from public.session_slots where id='sl_dt_past_booked'), 'published', 'PAST booked slot untouched — still published');
select is((select booked_count from public.session_slots where id='sl_dt_past_booked'), 1, 'PAST slot booked_count untouched');
select is((select status from public.bookings where id='bk_dt_past_booked'), 'booked', 'PAST booking status untouched — no refund, no cancel');
select is((select status from public.session_slots where id='sl_dt_past_attended'), 'published', 'PAST attended slot untouched');
select is((select status from public.bookings where id='bk_dt_past_attended'), 'attended', 'PAST attended booking untouched');
select is((select quantity_remaining from public.credit_batches where id='cb_dt_past'), 3, 'the past bookings'' shared credit batch is untouched — no refund for history');
select is((select count(*)::int from public.notifications where player_id='pl_dt_e'), 0, 'no notification was ever sent for a past session');

-- ── the rule itself: retired, not hard-deleted ──
select isnt((select deleted_at from public.availability_templates where id='at_dt'), null, 'the rule is retired (deleted_at set)');
select is((select is_active from public.availability_templates where id='at_dt'), false, 'is_active forced false — never mistaken for a mere pause');
select is((select count(*)::int from public.availability_templates where id='at_dt'), 1, 'the row still EXISTS — retired, not hard-deleted (past sessions keep a real template_id)');

-- ════════════════════════════════════════════════════════════════════════════
-- Idempotency — a second call (double-click) is a clean no-op
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
create temporary table tmp_dt_second as select public.delete_template('at_dt') as v;
select is((select v->>'ok' from tmp_dt_second), 'true', 'second call still ok');
select is((select v->>'already_deleted' from tmp_dt_second), 'true', 'second call reports already_deleted');
select is((select v->>'cancelled_count' from tmp_dt_second), '0', 'second call cancels nothing further — no double refund, no double notification');
drop table tmp_dt_second;
reset role;
select is((select count(*)::int from public.notifications where player_id='pl_dt_a' and slot_id='sl_dt_future_booked' and type='session_cancelled'), 1, 'still exactly ONE notification after the second call — no double-send');

select * from finish();
rollback;
