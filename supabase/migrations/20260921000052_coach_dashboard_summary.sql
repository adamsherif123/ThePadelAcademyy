-- ============================================================================
-- Coach dashboard — one aggregate call for the whole screen.
--
-- The dashboard wants nine or so numbers that each span every session the coach
-- has taught this month and the rosters on them. Computing that client-side would
-- mean pulling all of those sessions plus a roster call per session, which is
-- exactly the over-fetching the bounded-fetch work removed everywhere else. So the
-- numbers are computed where the rows already are, and the client makes ONE call.
--
-- ── scoping: there is no coach parameter ──
-- The RPC resolves the caller with current_coach_id() and takes no argument, so a
-- coach cannot ask for another coach's numbers — there is nothing to pass. That is
-- a stronger guarantee than validating a parameter, and it costs nothing here: the
-- admin has its own dashboard over every coach and does not need this one.
-- A caller with no coach link gets NULL, which the client renders as "not linked"
-- rather than a screen full of zeros that look like a bad month.
--
-- ── it returns counts, never rows ──
-- This reads booking data, which a coach otherwise cannot see (bookings are
-- own-or-admin). What comes back is scalars: counts, a percentage and hours. No
-- player id, name, level or contact detail is in the output at all — unlike
-- coach_session_roster, which returns name+level for ONE session and is the only
-- place a coach sees a person.
-- ============================================================================

-- ── the single definition of "hours that count" ──────────────────────────────
-- Character-for-character the predicate coach_hours_coached uses: PUBLISHED,
-- FINISHED (ends_at <= now()), and at least one booking on it marked attended —
-- with ends_at deciding which window a session falls in, on both bounds, so a
-- session running 11:30pm→12:30am belongs to the period it FINISHED in and can
-- never be double-counted or dropped between two of them.
--
-- It exists so the monthly figure and the weekly bars below cannot drift apart:
-- they are the same function over different windows, not two hand-written copies.
-- That the result also equals coach_hours_coached is asserted in pgTAP rather than
-- assumed, since that function stays the payroll source of truth and this one must
-- never quietly disagree with the Hours tab.
create or replace function tpa.coach_hours_between(
  p_coach text,
  p_from  timestamptz,
  p_to    timestamptz
)
  returns numeric
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0), 0)::numeric
  from public.session_slots s
  where s.coach_id = p_coach
    and s.status = 'published'
    and s.ends_at >= p_from
    and s.ends_at <  p_to
    and s.ends_at <= now()
    -- EXISTS, never a JOIN: a semi-join counts a qualifying slot ONCE however many
    -- attended bookings sit on it.
    and exists (
      select 1 from public.bookings b
      where b.slot_id = s.id and b.status = 'attended'
    )
$$;

revoke all on function tpa.coach_hours_between(text, timestamptz, timestamptz) from public, anon, authenticated;

-- ── the dashboard ────────────────────────────────────────────────────────────
create or replace function public.coach_dashboard_summary()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_coach        text := (select public.current_coach_id());
  -- Cairo wall-clock boundaries, computed as naive timestamps and converted once,
  -- so a session at 11pm on the last day of a month lands in the right month. The
  -- month is ADDED before the conversion for the same reason coach_hours_coached
  -- does it: calendar arithmetic on a naive timestamp has no offset to get wrong
  -- across a DST edge, and the single conversion afterwards picks up whichever
  -- offset is actually in force.
  v_m_local      timestamp;
  v_w_local      timestamp;
  v_month_start  timestamptz;
  v_month_end    timestamptz;
  v_prev_start   timestamptz;
  v_week_start   timestamptz;
  v_week_end     timestamptz;
  v_weekly       jsonb;
begin
  -- No link, no dashboard. NULL rather than zeros: "you are not a coach" and
  -- "you coached nothing this month" are different answers.
  if v_coach is null then
    return null;
  end if;

  v_m_local     := date_trunc('month', now() at time zone 'Africa/Cairo');
  v_month_start := v_m_local at time zone 'Africa/Cairo';
  v_month_end   := (v_m_local + interval '1 month') at time zone 'Africa/Cairo';
  v_prev_start  := (v_m_local - interval '1 month') at time zone 'Africa/Cairo';

  -- Weeks start SUNDAY, matching @tpa/core's cairoWeekStart (and the admin's
  -- Sunday-bucketed revenue chart). Postgres truncates to Monday, so the day is
  -- shifted either side of the truncation to move the boundary back one day.
  v_w_local    := date_trunc('week', (now() at time zone 'Africa/Cairo') + interval '1 day') - interval '1 day';
  v_week_start := v_w_local at time zone 'Africa/Cairo';
  v_week_end   := (v_w_local + interval '7 days') at time zone 'Africa/Cairo';

  -- The last 4 Cairo weeks, OLDEST first, so the client can render the bars left
  -- to right without reversing. Each bucket is [start, start+7d) and uses the same
  -- hours definition as the month, so a week and the month can never disagree.
  select jsonb_agg(
           jsonb_build_object(
             'week_start', to_char((w.local_start at time zone 'Africa/Cairo') at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
             'hours', tpa.coach_hours_between(
                        v_coach,
                        w.local_start at time zone 'Africa/Cairo',
                        (w.local_start + interval '7 days') at time zone 'Africa/Cairo')
           )
           order by w.local_start
         )
    into v_weekly
    from (
      select v_w_local - (n || ' weeks')::interval as local_start
      from generate_series(0, 3) n
    ) w;

  return jsonb_build_object(
    -- Sessions the coach is ON, by when they START (a schedule question, unlike
    -- hours, which is a payroll question and keys on when a session ENDED).
    'sessions_this_month', (
      select count(*) from public.session_slots s
      where s.coach_id = v_coach and s.status = 'published'
        and s.starts_at >= v_month_start and s.starts_at < v_month_end),
    'sessions_this_week', (
      select count(*) from public.session_slots s
      where s.coach_id = v_coach and s.status = 'published'
        and s.starts_at >= v_week_start and s.starts_at < v_week_end),
    'upcoming_count', (
      select count(*) from public.session_slots s
      where s.coach_id = v_coach and s.status = 'published' and s.starts_at > now()),

    -- DISTINCT people, not bookings: a player on three of the coach's sessions
    -- this month is one student, and that is the number a coach means by "how many
    -- students have I had".
    'students_this_month', (
      select count(distinct b.player_id)
      from public.bookings b
      join public.session_slots s on s.id = b.slot_id
      where s.coach_id = v_coach and s.status = 'published'
        and s.starts_at >= v_month_start and s.starts_at < v_month_end
        and b.status <> 'cancelled'),

    -- Average occupancy across THIS MONTH's sessions, as a whole percentage — the
    -- same window as every other figure on the card, so the row reads as one
    -- period rather than a mix. Averaged per session rather than
    -- total-booked/total-capacity, so a big group session cannot drown out a
    -- one-to-one. 0 when there are no sessions to average.
    'fill_rate', (
      select coalesce(round(avg(s.booked_count::numeric / nullif(s.capacity, 0)) * 100), 0)::int
      from public.session_slots s
      where s.coach_id = v_coach and s.status = 'published'
        and s.starts_at >= v_month_start and s.starts_at < v_month_end),

    -- This month by type. An OPEN block (training_type null) and a trial are
    -- counted in sessions_this_month but belong to none of these three buckets, so
    -- the breakdown sums to sessions_this_month only when every session is typed.
    'breakdown', jsonb_build_object(
      'group', (select count(*) from public.session_slots s
                where s.coach_id = v_coach and s.status = 'published' and s.training_type = 'group'
                  and s.starts_at >= v_month_start and s.starts_at < v_month_end),
      'duo', (select count(*) from public.session_slots s
              where s.coach_id = v_coach and s.status = 'published' and s.training_type = 'duo'
                and s.starts_at >= v_month_start and s.starts_at < v_month_end),
      'individual', (select count(*) from public.session_slots s
                     where s.coach_id = v_coach and s.status = 'published' and s.training_type = 'individual'
                       and s.starts_at >= v_month_start and s.starts_at < v_month_end)),

    -- Earned hours, on the same finished+attended rule as the Hours tab.
    'hours_this_month', tpa.coach_hours_between(v_coach, v_month_start, v_month_end),
    'hours_last_month', tpa.coach_hours_between(v_coach, v_prev_start, v_month_start),
    'weekly_hours', coalesce(v_weekly, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.coach_dashboard_summary() from public, anon;
grant execute on function public.coach_dashboard_summary() to authenticated;
