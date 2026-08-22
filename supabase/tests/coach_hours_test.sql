-- ============================================================================
-- coach_hours_coached(p_month date default null) — "Hours coached" per coach for
-- ONE calendar month (Africa/Cairo), an admin-gated SQL aggregate. Proves:
--
--  the rules carried over from 042 (all asserted inside a FIXED past month, so
--  they can never flake near a real month boundary):
--   * a single attended 1h session -> 1.0, and multiple slots SUM;
--   * the once-per-slot crux: a slot with THREE attended bookings contributes
--     its duration ONCE (2.0), never 3x (6.0) — the EXISTS-not-JOIN guarantee;
--   * "one attendee is enough": 1 attended + 2 no_show -> the FULL duration;
--   * a CANCELLED slot -> 0, even with an attended booking on it;
--   * a no-show-only slot -> 0; an EMPTY slot -> 0;
--   * duration precision (1.5h -> 1.5); no cross-contamination between coaches;
--   * a non-admin caller gets zero rows (the only gate, RLS-style, no error).
--
--  the month window itself:
--   * a session that ended THIS month counts, and one that ended LAST month does
--     NOT — the visible monthly "reset", with the row still sitting in the table;
--   * the boundary is CAIRO, not UTC: 01:00 Cairo on the 1st COUNTS (a UTC
--     date_trunc would drop it), and 23:00 Cairo on the last day of the previous
--     month does NOT leak in;
--   * the window keys on ends_at: a session that starts in one month and ends in
--     the next belongs, whole, to the month it FINISHED in;
--   * the upper bound is DST-correct across Cairo's April changeover — proving
--     the month is added in wall-clock space, not to a timestamptz;
--   * an IN-PROGRESS slot -> 0 and a FUTURE slot -> 0 (ends_at <= now() still
--     applies on top of the month window);
--   * p_month answers any past month (payroll), accepts any day within it, and
--     past-month hours never leak into the default current-month call.
--
-- Fixed anchors: March 2026 (Cairo +02) and April 2026 (Cairo +02 -> +03 on
-- Apr 24). Both are permanently in the past, so `ends_at <= now()` holds forever.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(26);

-- ── seed as postgres (RLS bypassed) ─────────────────────────────────────────
insert into auth.users (id) values
  ('c0000000-c000-c000-c000-c00000000000'),   -- admin
  ('c1000000-c100-c100-c100-c10000000001');   -- a non-admin player, for the gating check

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_ch', 'c0000000-c000-c000-c000-c00000000000', 'AdmCh', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ch_gate', '+201900006099', 'Gate', 'men', 'beginner', now(), 'c1000000-c100-c100-c100-c10000000001');

-- One player per booking is enough (a booking's OWN status is what matters,
-- not who made it) — reuse a small pool across every slot below.
insert into auth.users (id)
  select ('c2000000-c200-c200-c200-c2000000000' || i)::uuid from generate_series(1, 9) as i;
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id)
  select 'pl_ch_' || i, '+20190000700' || i, 'P' || i, 'men', 'beginner', now(),
         ('c2000000-c200-c200-c200-c2000000000' || i)::uuid
  from generate_series(1, 9) as i;

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
  select 'cb_ch_' || i, 'pl_ch_' || i, 'signup_grant', null, 'trial', 1, 0, now()+interval '30 day', now()-interval '10 day'
  from generate_series(1, 9) as i;

-- One dedicated coach per scenario, so each coach's total isolates exactly one
-- behavior.
insert into public.coaches (id, name, bio, is_active) values
  ('co_ch_a', 'A', 'b', true), ('co_ch_b', 'B', 'b', true), ('co_ch_c', 'C', 'b', true),
  ('co_ch_d', 'D', 'b', true), ('co_ch_e', 'E', 'b', true), ('co_ch_g', 'G', 'b', true),
  ('co_ch_j', 'J', 'b', true),
  ('co_ch_lo', 'Lo', 'b', true), ('co_ch_pre', 'Pre', 'b', true), ('co_ch_cross', 'Cross', 'b', true),
  ('co_ch_dstin', 'DstIn', 'b', true), ('co_ch_dstout', 'DstOut', 'b', true),
  ('co_ch_pay', 'Pay', 'b', true),
  ('co_ch_now', 'Now', 'b', true), ('co_ch_last', 'Last', 'b', true), ('co_ch_first', 'First', 'b', true),
  ('co_ch_f', 'F', 'b', true), ('co_ch_h', 'H', 'b', true);

-- ════════════════════════════════════════════════════════════════════════════
-- Slots — MARCH 2026 (Cairo = UTC+02). Cairo month window for March is
-- [2026-02-28 22:00Z, 2026-03-31 22:00Z).
-- ════════════════════════════════════════════════════════════════════════════
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  -- A) TWO qualifying 1h slots for the SAME coach -> sums to 2.0.
  ('sl_ch_a1', 'co_ch_a', timestamp '2026-03-05 09:00' at time zone 'Africa/Cairo', timestamp '2026-03-05 10:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  ('sl_ch_a2', 'co_ch_a', timestamp '2026-03-06 09:00' at time zone 'Africa/Cairo', timestamp '2026-03-06 10:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  -- B) ONE 2h slot, THREE attended bookings -> must be 2.0, not 6.0.
  ('sl_ch_b1', 'co_ch_b', timestamp '2026-03-07 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-07 10:00' at time zone 'Africa/Cairo', 'group', 4, 3, 'men', 'beginner', 'published'),
  -- C) ONE 0.5h slot, 1 attended + 2 no_show -> 0.5 (one attendee is enough).
  ('sl_ch_c1', 'co_ch_c', timestamp '2026-03-08 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-08 08:30' at time zone 'Africa/Cairo', 'group', 4, 3, 'men', 'beginner', 'published'),
  -- D) CANCELLED slot with an attended booking on it -> 0.
  ('sl_ch_d1', 'co_ch_d', timestamp '2026-03-09 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-09 09:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'cancelled'),
  -- E) no-show-only -> 0.
  ('sl_ch_e1', 'co_ch_e', timestamp '2026-03-10 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-10 09:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  -- G) EMPTY (zero bookings) -> 0.
  ('sl_ch_g1', 'co_ch_g', timestamp '2026-03-11 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-11 09:00' at time zone 'Africa/Cairo', 'individual', 1, 0, null, null, 'published'),
  -- J) 1.5h duration precision.
  ('sl_ch_j1', 'co_ch_j', timestamp '2026-03-12 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-12 09:30' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),

  -- ── the Cairo-vs-UTC month boundary ──────────────────────────────────────
  -- LO) ends 01:00 Cairo on the 1st = 2026-02-28 23:00Z. INSIDE the Cairo window
  -- (>= 2026-02-28 22:00Z) but BEFORE the UTC one (2026-03-01 00:00Z) — this is
  -- the case a UTC date_trunc would silently drop from every month.
  ('sl_ch_lo1', 'co_ch_lo', timestamp '2026-03-01 00:00' at time zone 'Africa/Cairo', timestamp '2026-03-01 01:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  -- PRE) ends 23:00 Cairo on the LAST day of February = 2026-02-28 21:00Z, one
  -- hour outside the window -> must NOT leak into March.
  ('sl_ch_pre1', 'co_ch_pre', timestamp '2026-02-28 22:00' at time zone 'Africa/Cairo', timestamp '2026-02-28 23:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  -- CROSS) starts 23:30 Cairo Feb 28, ends 00:30 Cairo Mar 1 — belongs, WHOLE,
  -- to the month it FINISHED in.
  ('sl_ch_cross1', 'co_ch_cross', timestamp '2026-02-28 23:30' at time zone 'Africa/Cairo', timestamp '2026-03-01 00:30' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),

  -- ── the DST-crossing upper bound (Cairo goes +02 -> +03 on 2026-04-24) ────
  -- April's Cairo window is [2026-03-31 22:00Z, 2026-04-30 21:00Z). Adding the
  -- month to the timestamptz instead of the wall clock would put the upper bound
  -- at 2026-04-30 22:00Z (and, adding to 2026-03-31 22:00Z, on April 30 rather
  -- than May 1 at all) — these two slots straddle exactly that error.
  -- DSTIN) ends 23:30 Cairo Apr 30 = 20:30Z -> inside April.
  ('sl_ch_dstin1', 'co_ch_dstin', timestamp '2026-04-30 22:30' at time zone 'Africa/Cairo', timestamp '2026-04-30 23:30' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  -- DSTOUT) ends 00:30 Cairo May 1 = 21:30Z -> a MAY session. The naive bound
  -- (22:00Z) would wrongly bill it to April.
  ('sl_ch_dstout1', 'co_ch_dstout', timestamp '2026-04-30 23:30' at time zone 'Africa/Cairo', timestamp '2026-05-01 00:30' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),

  -- ── payroll: the same coach in two different past months ─────────────────
  ('sl_ch_pay_mar', 'co_ch_pay', timestamp '2026-03-15 08:00' at time zone 'Africa/Cairo', timestamp '2026-03-15 09:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published'),
  ('sl_ch_pay_apr', 'co_ch_pay', timestamp '2026-04-15 08:00' at time zone 'Africa/Cairo', timestamp '2026-04-15 10:00' at time zone 'Africa/Cairo', 'individual', 1, 1, null, null, 'published');

-- ════════════════════════════════════════════════════════════════════════════
-- Slots — anchored to the LIVE clock, for the default (current-month) call.
-- Every one of these is expressed against now() or the current Cairo month
-- start, so it lands correctly whatever day the suite runs.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  -- NOW) ends EXACTLY at now(): finished, and necessarily inside the current
  -- Cairo month -> counts, and pins the inclusive `ends_at <= now()` edge.
  ('sl_ch_now1', 'co_ch_now', now()-interval '1 hour', now(), 'individual', 1, 1, null, null, 'published'),
  -- LAST) ends 23:00 Cairo on the last day of LAST month (one hour before this
  -- month's Cairo start) -> 0. This is the monthly "reset", and the row is still
  -- right here in the table, untouched.
  ('sl_ch_last1', 'co_ch_last',
     (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') - interval '2 hour',
     (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') - interval '1 hour',
     'individual', 1, 1, null, null, 'published'),
  -- FIRST) ends EXACTLY at this month's Cairo start, having started last month
  -- -> the lower bound is inclusive, and the whole duration lands in this month.
  ('sl_ch_first1', 'co_ch_first',
     (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo') - interval '1 hour',
     (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'),
     'individual', 1, 1, null, null, 'published'),
  -- F) FUTURE, artificially marked attended -> 0.
  ('sl_ch_f1', 'co_ch_f', now()+interval '1 day', now()+interval '1 day 1 hour', 'individual', 1, 1, null, null, 'published'),
  -- H) IN PROGRESS right now (started, not yet ended) -> 0 (ends_at > now()).
  ('sl_ch_h1', 'co_ch_h', now()-interval '30 minutes', now()+interval '30 minutes', 'individual', 1, 1, null, null, 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_ch_a1', 'sl_ch_a1', 'pl_ch_1', 'cb_ch_1', 'attended', now()-interval '200 day'),
  ('bk_ch_a2', 'sl_ch_a2', 'pl_ch_2', 'cb_ch_2', 'attended', now()-interval '200 day'),
  ('bk_ch_b1', 'sl_ch_b1', 'pl_ch_3', 'cb_ch_3', 'attended', now()-interval '200 day'),
  ('bk_ch_b2', 'sl_ch_b1', 'pl_ch_4', 'cb_ch_4', 'attended', now()-interval '200 day'),
  ('bk_ch_b3', 'sl_ch_b1', 'pl_ch_5', 'cb_ch_5', 'attended', now()-interval '200 day'),
  ('bk_ch_c1', 'sl_ch_c1', 'pl_ch_6', 'cb_ch_6', 'attended', now()-interval '200 day'),
  ('bk_ch_c2', 'sl_ch_c1', 'pl_ch_7', 'cb_ch_7', 'no_show', now()-interval '200 day'),
  ('bk_ch_c3', 'sl_ch_c1', 'pl_ch_8', 'cb_ch_8', 'no_show', now()-interval '200 day'),
  ('bk_ch_d1', 'sl_ch_d1', 'pl_ch_9', 'cb_ch_9', 'attended', now()-interval '200 day'),
  ('bk_ch_e1', 'sl_ch_e1', 'pl_ch_1', 'cb_ch_1', 'no_show', now()-interval '200 day'),
  ('bk_ch_j1', 'sl_ch_j1', 'pl_ch_2', 'cb_ch_2', 'attended', now()-interval '200 day'),
  ('bk_ch_lo1', 'sl_ch_lo1', 'pl_ch_3', 'cb_ch_3', 'attended', now()-interval '200 day'),
  ('bk_ch_pre1', 'sl_ch_pre1', 'pl_ch_4', 'cb_ch_4', 'attended', now()-interval '200 day'),
  ('bk_ch_cross1', 'sl_ch_cross1', 'pl_ch_5', 'cb_ch_5', 'attended', now()-interval '200 day'),
  ('bk_ch_dstin1', 'sl_ch_dstin1', 'pl_ch_6', 'cb_ch_6', 'attended', now()-interval '150 day'),
  ('bk_ch_dstout1', 'sl_ch_dstout1', 'pl_ch_7', 'cb_ch_7', 'attended', now()-interval '150 day'),
  ('bk_ch_pay_mar', 'sl_ch_pay_mar', 'pl_ch_8', 'cb_ch_8', 'attended', now()-interval '200 day'),
  ('bk_ch_pay_apr', 'sl_ch_pay_apr', 'pl_ch_9', 'cb_ch_9', 'attended', now()-interval '150 day'),
  ('bk_ch_now1', 'sl_ch_now1', 'pl_ch_1', 'cb_ch_1', 'attended', now()-interval '2 hour'),
  ('bk_ch_last1', 'sl_ch_last1', 'pl_ch_2', 'cb_ch_2', 'attended', now()-interval '2 hour'),
  ('bk_ch_first1', 'sl_ch_first1', 'pl_ch_3', 'cb_ch_3', 'attended', now()-interval '2 hour'),
  ('bk_ch_f1', 'sl_ch_f1', 'pl_ch_4', 'cb_ch_4', 'attended', now()-interval '1 hour'),
  ('bk_ch_h1', 'sl_ch_h1', 'pl_ch_5', 'cb_ch_5', 'attended', now()-interval '20 minutes');

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c0000000-c000-c000-c000-c00000000000","role":"authenticated"}',true);

-- ── the 042 rules, re-proven inside a fixed month ───────────────────────────
select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_a'),
  2.0, 'A) two separate 1h qualifying slots in the same month SUM to 2.0');

select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_b'),
  2.0, 'B) THREE attended bookings on one 2h slot -> 2.0 ONCE, not 6.0 (the once-per-slot crux)');

select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_c'),
  0.5, 'C) 1 attended + 2 no_show on a 0.5h slot -> still the FULL 0.5 (one attendee is enough)');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_d'),
  0, 'D) a CANCELLED slot contributes 0, even with an attended booking on it');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_e'),
  0, 'E) no-show-only (nobody attended) -> 0');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_g'),
  0, 'G) an EMPTY slot (zero bookings) contributes 0');

select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_j'),
  1.5, 'J) duration precision: a 1.5h slot reports 1.5, not rounded to 1 or 2');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-03-01') where coach_id in ('co_ch_a','co_ch_b')),
  2, 'two coaches each get their OWN row (correct per-coach GROUP BY split)');
select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_a'),
  2.0, 'A''s total is UNCHANGED by B''s presence in the same result set');
select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_b'),
  2.0, 'B''s total is UNCHANGED by A''s presence in the same result set');

-- ── the month boundary is CAIRO, not UTC ────────────────────────────────────
select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_lo'),
  1.0, 'CAIRO LOWER BOUND: a session ending 01:00 Cairo on the 1st COUNTS — a UTC date_trunc would drop it');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_pre'),
  0, 'CAIRO LOWER BOUND: 23:00 Cairo on the LAST day of the previous month does NOT leak in');

select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_cross'),
  1.0, 'the window keys on ends_at: a 23:30->00:30 session belongs WHOLE to the month it FINISHED in');

-- ── the upper bound is DST-correct (Cairo +02 -> +03 on 2026-04-24) ─────────
select is(
  (select hours from public.coach_hours_coached('2026-04-01') where coach_id = 'co_ch_dstin'),
  1.0, 'DST UPPER BOUND: a session ending 23:30 Cairo on Apr 30 counts in April');

select is(
  (select count(*)::int from public.coach_hours_coached('2026-04-01') where coach_id = 'co_ch_dstout'),
  0, 'DST UPPER BOUND: 00:30 Cairo on May 1 is NOT April — the month is added in wall-clock space, not to a timestamptz');

select is(
  (select hours from public.coach_hours_coached('2026-05-01') where coach_id = 'co_ch_dstout'),
  1.0, 'that same 00:30-Cairo-on-May-1 session lands in MAY — no hour is lost between the two months');

-- ── p_month: any past month, on demand (payroll) ────────────────────────────
select is(
  (select hours from public.coach_hours_coached('2026-03-01') where coach_id = 'co_ch_pay'),
  1.0, 'p_month) March is still computable long after March — 1.0');

select is(
  (select hours from public.coach_hours_coached('2026-04-01') where coach_id = 'co_ch_pay'),
  2.0, 'p_month) the SAME coach''s April is a separate 2.0 — months never bleed together');

select is(
  (select count(*)::int from public.coach_hours_coached() where coach_id = 'co_ch_pay'),
  0, 'p_month) those past-month hours do NOT appear in the default current-month call');

select is(
  (select hours from public.coach_hours_coached('2026-03-17') where coach_id = 'co_ch_pay'),
  1.0, 'p_month) any day inside the month works — 2026-03-17 answers for all of March');

-- ── the default call: the current Cairo month, which is what the tile reads ──
select is(
  (select hours from public.coach_hours_coached() where coach_id = 'co_ch_now'),
  1.0, 'CURRENT MONTH: a session that just ended THIS month counts (and ends_at = now() is inclusive)');

select is(
  (select count(*)::int from public.coach_hours_coached() where coach_id = 'co_ch_last'),
  0, 'CURRENT MONTH: a session from LAST month contributes 0 — the visible monthly reset, with the row still in the table');

select is(
  (select hours from public.coach_hours_coached() where coach_id = 'co_ch_first'),
  1.0, 'CURRENT MONTH: a session ending EXACTLY at the Cairo month start counts (inclusive lower bound)');

select is(
  (select count(*)::int from public.coach_hours_coached() where coach_id = 'co_ch_h'),
  0, 'CURRENT MONTH: an IN-PROGRESS slot still contributes 0 — ends_at <= now() applies on top of the window');

select is(
  (select count(*)::int from public.coach_hours_coached() where coach_id = 'co_ch_f'),
  0, 'CURRENT MONTH: a FUTURE slot contributes 0, even if (artificially) marked attended');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS A NON-ADMIN PLAYER — the only gate, RLS-style: silently zero rows.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c1000000-c100-c100-c100-c10000000001","role":"authenticated"}',true);
select is(
  (select count(*)::int from public.coach_hours_coached()),
  0, 'a non-admin caller gets ZERO rows back, not an error (RLS-style gating, not {ok,reason})');
reset role;

select * from finish();
rollback;
