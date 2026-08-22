-- ============================================================================
-- "Hours coached" becomes CURRENT-MONTH — a date filter on the existing
-- aggregate, and gains an optional p_month so any past month stays queryable.
--
-- ── what changed, and what did NOT ──
-- Migration 042 summed EVERY qualifying slot for all time. The academy wants a
-- per-month figure (payroll rhythm), so the tile reads 0 on the 1st and climbs
-- through the month. This is a WHERE clause, not a reset: no attendance row is
-- touched, no slot is deleted, and July's hours are still one call away
-- (coach_hours_coached('2026-07-01')). Nothing is destroyed and nothing is
-- recomputed at midnight — the window simply moves.
--
-- ── the window: [month_start, next_month_start) ∩ (…, now()] ──
-- A slot contributes its full duration once iff, unchanged from 042: it's
-- PUBLISHED, it's FINISHED (ends_at <= now()), and at least ONE booking on it
-- is 'attended'. NEW: its ends_at also falls inside the requested Cairo month.
-- ends_at is the key on both bounds, deliberately — the same instant that
-- decides "has this been coached yet" decides "which month was it coached in",
-- so a session running 11:30pm→12:30am belongs to the month it FINISHED in, and
-- can never be double-counted or dropped between two months.
--
-- ── why the month boundary is computed in Cairo, not UTC ──
-- Cairo is UTC+2 (winter) / UTC+3 (summer), so the 1st of the month in Cairo
-- starts 2–3 hours BEFORE the 1st in UTC. Under a naive
-- date_trunc('month', now()) the sessions coached between midnight and 2–3am on
-- the 1st — real, already-finished Cairo sessions — would fall outside both
-- months' windows and vanish from payroll entirely. The codebase already treats
-- Cairo as the wall clock of record (tpa.cairo_when, @tpa/core's CAIRO_TZ), and
-- this follows it: the boundary is computed in Cairo wall-clock space and only
-- then converted back to an instant.
--
--   date_trunc('month', now() at time zone 'Africa/Cairo')  -- Cairo wall clock,
--                                                           -- midnight on the 1st
--   … at time zone 'Africa/Cairo'                           -- back to an instant
--
-- ── why the month is ADDED before the conversion, not after ──
-- next_month_start is (m_local + interval '1 month') at time zone 'Africa/Cairo',
-- NOT month_start + interval '1 month'. Adding to a timestamptz does calendar
-- arithmetic in the SESSION's TimeZone (UTC under PostgREST), which is wrong
-- twice over across a DST edge: for October 2026, month_start is
-- 2026-09-30 21:00Z, and 21:00Z + 1 month lands on OCTOBER 30, an entire day
-- short of the real boundary (2026-10-31 22:00Z, when Cairo has already fallen
-- back to +02). Adding one month to a plain `timestamp` is pure calendar
-- arithmetic with no offset to get wrong, and the single conversion afterwards
-- picks up whichever offset is actually in force on that date. Proven for the
-- April 2026 DST-start edge in coach_hours_test.sql.
--
-- ── why an optional p_month, rather than hard-coding "this month" ──
-- The tile only ever wants the current month, and p_month default null gives it
-- exactly that with an unchanged client call (supabase.rpc('coach_hours_coached')
-- — PostgREST resolves an all-defaults signature from an empty body). But the
-- same aggregate then answers "what did Maged coach in July?" for free, which is
-- the question payroll will actually ask, and it makes the month-scoping
-- TESTABLE at a fixed date instead of relative to whenever the suite runs. A
-- second near-identical function later would be the worse trade. p_month is a
-- DATE and any day inside the month works — it is date_trunc'd, so
-- '2026-07-01' and '2026-07-17' are the same query.
--
-- ── why DROP then CREATE ──
-- create-or-replace cannot add a parameter; it would leave the 0-arg function in
-- place beside the new 1-arg one and every existing call site would fail as
-- ambiguous ("function coach_hours_coached() is not unique"). Dropping the old
-- signature is what makes this replacement additive in effect. The grants below
-- are re-stated for the new signature for the same reason.
-- ============================================================================

drop function if exists public.coach_hours_coached();

create or replace function public.coach_hours_coached(p_month date default null)
  returns table (coach_id text, hours numeric)
  language sql
  security definer
  set search_path = ''
  stable
as $$
  with local_start as (
    -- Cairo wall-clock midnight on the 1st of the requested month (default: the
    -- month Cairo is in right now). Still a naive timestamp at this point.
    select date_trunc('month',
             coalesce(p_month::timestamp, now() at time zone 'Africa/Cairo')
           ) as m
  ),
  win as (
    select (m at time zone 'Africa/Cairo')                        as month_start,
           ((m + interval '1 month') at time zone 'Africa/Cairo') as next_month_start
    from local_start
  )
  select s.coach_id,
         sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)::numeric as hours
  -- win is exactly one row, so this cross join cannot multiply a slot's
  -- contribution — the once-per-slot guarantee below is untouched by it.
  from public.session_slots s
  cross join win w
  where (select public.is_admin())
    and s.status = 'published'
    and s.ends_at >= w.month_start
    and s.ends_at <  w.next_month_start
    and s.ends_at <= now()
    -- EXISTS, never a JOIN: a semi-join selects a qualifying slot ONCE however
    -- many attended bookings sit on it (042's correctness crux, preserved).
    and exists (
      select 1 from public.bookings b
      where b.slot_id = s.id and b.status = 'attended'
    )
  group by s.coach_id
$$;

revoke all on function public.coach_hours_coached(date) from public;
grant execute on function public.coach_hours_coached(date) to authenticated;
