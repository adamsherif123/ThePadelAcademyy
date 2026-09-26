-- ============================================================================
-- coach_dashboard_summary — the one aggregate behind the coach Dashboard (pgTAP).
--
-- The claims worth pinning: the numbers are right, the hours agree with
-- coach_hours_coached (the payroll source of truth — this must never quietly
-- disagree with the Hours tab), a coach sees only their own, and the output is
-- counts with no person in it anywhere.
--
-- The fixture sits within 90 minutes either side of now, so "today" — and
-- therefore this Cairo week and month — holds regardless of when the suite runs.
-- The only exception is a run in the first 90 minutes of the 1st of a month, or of
-- a Sunday, which would split the fixture across the boundary being asserted.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(28);

insert into auth.users (id) values
  ('0f0f0f01-0000-0000-0000-00000000f001'),   -- coach A (the subject)
  ('0f0f0f02-0000-0000-0000-00000000f002'),   -- coach B (must stay invisible to A)
  ('0f0f0f03-0000-0000-0000-00000000f003');   -- an ordinary player

insert into public.coaches (id, name, bio, is_active) values
  ('co_dash_a', 'Dash Coach A', 'b', true),
  ('co_dash_b', 'Dash Coach B', 'b', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, email, coach_id) values
  ('pl_dash_a',  '+201900040001', 'Coach Ay Dash', 'men', 'beginner', now(), '0f0f0f01-0000-0000-0000-00000000f001', 'dasha@x.eg', 'co_dash_a'),
  ('pl_dash_b',  '+201900040002', 'Coach Bee Dash','men', 'beginner', now(), '0f0f0f02-0000-0000-0000-00000000f002', 'dashb@x.eg', 'co_dash_b'),
  ('pl_plainest','+201900040003', 'Plain Person',  'men', 'beginner', now(), '0f0f0f03-0000-0000-0000-00000000f003', 'plain@x.eg', null),
  ('pl_st1', '+201900040011', 'Zed Student',   'men',    'beginner',     now(), null, 's1@x.eg', null),
  ('pl_st2', '+201900040012', 'Yara Student',  'ladies', 'intermediate', now(), null, 's2@x.eg', null),
  ('pl_st3', '+201900040013', 'Xena Student',  'ladies', 'beginner',     now(), null, 's3@x.eg', null),
  ('pl_st4', '+201900040014', 'Walid Dropout', 'men',    'beginner',     now(), null, 's4@x.eg', null);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id)
select 'cb_'||p, p, 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now(), 'loc_oro_plaza'
from unnest(array['pl_st1','pl_st2','pl_st3','pl_st4']) p;

-- Coach A: three finished sessions and one upcoming, all inside today.
--   s1  group      30 min, 2/4 booked, ATTENDED  -> counts 0.5h
--   s2  duo        30 min, 1/2 booked, ATTENDED  -> counts 0.5h
--   s3  individual 20 min, 1/1 booked, booked only (nobody marked attended) -> 0h
--   s4  group      upcoming, 1/4 booked
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_da1', 'co_dash_a', now()-interval '90 minutes', now()-interval '60 minutes', 'group',      4, 2, 'men', 'beginner', 'published'),
  ('sl_da2', 'co_dash_a', now()-interval '60 minutes', now()-interval '30 minutes', 'duo',        2, 1, null,  null,       'published'),
  ('sl_da3', 'co_dash_a', now()-interval '30 minutes', now()-interval '10 minutes', 'individual', 1, 1, null,  null,       'published'),
  ('sl_da4', 'co_dash_a', now()+interval '60 minutes', now()+interval '120 minutes','group',      4, 1, 'men', 'beginner', 'published'),
  -- Coach B's own session, finished and attended: must never reach coach A.
  ('sl_db1', 'co_dash_b', now()-interval '90 minutes', now()-interval '30 minutes', 'group',      4, 1, 'men', 'beginner', 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id) values
  ('bk_da1a', 'sl_da1', 'pl_st1', 'cb_pl_st1', 'attended',  now(), null, 'loc_oro_plaza'),
  ('bk_da1b', 'sl_da1', 'pl_st2', 'cb_pl_st2', 'attended',  now(), null, 'loc_oro_plaza'),
  -- A cancelled seat on the same session: not a student, not court time.
  ('bk_da1c', 'sl_da1', 'pl_st4', 'cb_pl_st4', 'cancelled', now(), now(), 'loc_oro_plaza'),
  -- st1 again: the SAME person on a second session — one student, not two.
  ('bk_da2a', 'sl_da2', 'pl_st1', 'cb_pl_st1', 'attended',  now(), null, 'loc_oro_plaza'),
  ('bk_da3a', 'sl_da3', 'pl_st3', 'cb_pl_st3', 'booked',    now(), null, 'loc_oro_plaza'),
  ('bk_da4a', 'sl_da4', 'pl_st1', 'cb_pl_st1', 'booked',    now(), null, 'loc_oro_plaza'),
  ('bk_db1a', 'sl_db1', 'pl_st2', 'cb_pl_st2', 'attended',  now(), null, 'loc_oro_plaza');

-- Sanity on the fixture itself, as postgres (RLS bypassed): there are genuinely
-- MORE bookings than distinct students, so the distinct below is doing real work
-- rather than agreeing with a count that happens to match.
select is(
  (select count(*)::int from public.bookings b join public.session_slots s on s.id=b.slot_id
    where s.coach_id='co_dash_a' and b.status <> 'cancelled'),
  5, 'the fixture has 5 non-cancelled bookings across coach A''s sessions — more than the 3 students');

-- ════════════════════════════════════════════════════════════════════════════
-- The numbers, as coach A
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f01-0000-0000-0000-00000000f001","role":"authenticated"}', true);

select is((public.coach_dashboard_summary()->>'sessions_this_month')::int, 4, 'sessions_this_month counts all four of the coach''s sessions');
select is((public.coach_dashboard_summary()->>'sessions_this_week')::int, 4, 'sessions_this_week likewise — the fixture is all today');
select is((public.coach_dashboard_summary()->>'upcoming_count')::int, 1, 'upcoming_count is the one session that has not started');

select is((public.coach_dashboard_summary()->>'students_this_month')::int, 3,
  'students_this_month counts DISTINCT people — st1 on two sessions is one student');
select is((public.coach_dashboard_summary()->>'students_this_month')::int, 3,
  'a CANCELLED seat is not a student');

-- avg(2/4, 1/2, 1/1, 1/4) = 0.5625 -> 56%
-- Why this RPC has to be SECURITY DEFINER at all: the same coach reading bookings
-- DIRECTLY sees nothing, because bookings are own-or-admin. The aggregate is the
-- only way these numbers can be computed for them, and it hands back counts only.
select is(
  (select count(*)::int from public.bookings b join public.session_slots s on s.id=b.slot_id
    where s.coach_id='co_dash_a' and b.status <> 'cancelled'),
  0, 'a coach reading bookings directly sees NONE of them — RLS, not the RPC, is what hides them');

select is((public.coach_dashboard_summary()->>'fill_rate')::int, 56,
  'fill_rate averages occupancy PER SESSION, so a big group cannot drown out a one-to-one');

select is((public.coach_dashboard_summary()->'breakdown'->>'group')::int, 2, 'breakdown: two group sessions');
select is((public.coach_dashboard_summary()->'breakdown'->>'duo')::int, 1, 'breakdown: one duo');
select is((public.coach_dashboard_summary()->'breakdown'->>'individual')::int, 1, 'breakdown: one individual');
select is(
  (select ((d->'breakdown'->>'group')::int + (d->'breakdown'->>'duo')::int + (d->'breakdown'->>'individual')::int)
   from (select public.coach_dashboard_summary() d) x),
  4, 'the breakdown sums to sessions_this_month (every session in this fixture is typed)');

-- ════════════════════════════════════════════════════════════════════════════
-- HOURS — the consistency that matters most
-- ════════════════════════════════════════════════════════════════════════════
select is((public.coach_dashboard_summary()->>'hours_this_month')::numeric, 1.0::numeric,
  'hours_this_month counts only FINISHED sessions with someone marked attended (0.5 + 0.5)');
select is(
  (public.coach_dashboard_summary()->>'hours_this_month')::numeric,
  (select hours from public.coach_hours_coached() where coach_id = 'co_dash_a'),
  'and it equals coach_hours_coached EXACTLY — the dashboard can never disagree with the Hours tab');
select is((public.coach_dashboard_summary()->>'hours_last_month')::numeric, 0::numeric,
  'hours_last_month is zero — nothing in the fixture finished last month');

select is(jsonb_array_length(public.coach_dashboard_summary()->'weekly_hours'), 4,
  'weekly_hours is four buckets, one per week');
select is(
  (select sum((w->>'hours')::numeric) from jsonb_array_elements(public.coach_dashboard_summary()->'weekly_hours') w),
  (public.coach_dashboard_summary()->>'hours_this_month')::numeric,
  'the four weekly bars sum to the monthly total — same definition, different windows');
select is(
  (select (w->>'hours')::numeric from jsonb_array_elements(public.coach_dashboard_summary()->'weekly_hours') w
    order by (w->>'week_start') desc limit 1),
  1.0::numeric, 'and the CURRENT week (last bucket) carries the hours, since the fixture is today');
select is(
  (select (w->>'week_start') from jsonb_array_elements(public.coach_dashboard_summary()->'weekly_hours') w
    order by (w->>'week_start') asc limit 1),
  to_char((date_trunc('week', (now() at time zone 'Africa/Cairo') + interval '1 day')
           - interval '1 day' - interval '3 weeks')::date, 'YYYY-MM-DD'),
  'the buckets run oldest-first and start on a Cairo SUNDAY, matching cairoWeekStart');

-- ════════════════════════════════════════════════════════════════════════════
-- Nothing of coach B's leaks in
-- ════════════════════════════════════════════════════════════════════════════
select is((public.coach_dashboard_summary()->>'sessions_this_month')::int, 4,
  'coach B''s session is not in coach A''s session count');
select is((public.coach_dashboard_summary()->>'hours_this_month')::numeric, 1.0::numeric,
  'nor in coach A''s hours, though it is finished and attended');

-- ════════════════════════════════════════════════════════════════════════════
-- No person is in the output at all
-- ════════════════════════════════════════════════════════════════════════════
select ok(public.coach_dashboard_summary()::text not like '%Student%',
  'no player NAME appears anywhere in the payload');
select ok(public.coach_dashboard_summary()::text not like '%@x.eg%',
  'no player EMAIL appears anywhere in the payload');
select ok(public.coach_dashboard_summary()::text not like '%pl\_st%',
  'no player ID appears anywhere in the payload');
select ok(public.coach_dashboard_summary()::text not like '%+2019000400%',
  'no player PHONE appears anywhere in the payload');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Scoping
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002","role":"authenticated"}', true);
select is((public.coach_dashboard_summary()->>'sessions_this_month')::int, 1,
  'coach B gets their OWN summary — one session, not coach A''s four');
select is((public.coach_dashboard_summary()->>'students_this_month')::int, 1,
  '…and their own student count');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f03-0000-0000-0000-00000000f003","role":"authenticated"}', true);
select is(public.coach_dashboard_summary(), null,
  'an ordinary player gets NULL — "not a coach" is a different answer from "a quiet month"');
reset role;

select * from finish();
rollback;
