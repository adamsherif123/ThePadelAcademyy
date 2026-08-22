-- ============================================================================
-- "Hours coached" per coach — an admin-only, SQL-side aggregate (Coaches tab).
--
-- ── the rule, exactly ──
-- A session slot contributes its FULL duration once iff: (a) it's PAST — see
-- below for why ends_at, not starts_at; (b) it isn't cancelled
-- (session_slots.status = 'published'); (c) at least ONE of its bookings has
-- status = 'attended'. Regardless of training_type, and regardless of how many
-- OTHER bookings on that slot are no_show/cancelled/booked — one attendee is
-- enough, and it's the academy's real pay rule (a group session with 1 of 4
-- attending still ran the full session).
--
-- ── past = ends_at <= now(), not starts_at ──
-- mark_attendance's own gate is starts_at > now() ("hasn't started yet"), a
-- LOOSER bar — attendance can be marked mid-session. This metric is stricter on
-- purpose: it sums actual ELAPSED duration, and a session that's still running
-- hasn't finished being coached yet, so its hours aren't earned yet either. The
-- two gates measure different things (can-you-judge-attendance vs
-- has-the-full-duration-actually-happened) and are allowed to disagree.
--
-- ── once per slot, not once per attendee (the correctness crux) ──
-- The aggregate SELECTs FROM session_slots and uses EXISTS as a pure boolean
-- filter — never a JOIN against bookings. A JOIN would multiply a slot's
-- contribution by however many attended rows it has (a duo with 2 attendees
-- counted twice); EXISTS is a semi-join, so a qualifying slot is selected (and
-- so summed) exactly once, no matter how many bookings satisfy the EXISTS
-- clause. Proven in coach_hours_test.sql.
--
-- ── RPC, not a view ──
-- Every other admin-gated custom-logic read/write in this codebase is a
-- SECURITY DEFINER RPC with an explicit is_admin() check (never a bare view) —
-- this mirrors that convention rather than introducing a new shape. A plain
-- PostgREST select() can't express the EXISTS-gated, GROUP-BY-with-computed-
-- duration aggregate this needs, so (unlike bookingStatusCounts's 4 plain
-- head:true count queries) a custom function is genuinely required here, not
-- optional.
--
-- ── return shape: SETOF rows, not {ok, reason} ──
-- {ok, reason} is this codebase's WRITE-outcome shape (a command that can be
-- accepted or rejected for a stated reason). This is a READ with no business
-- rejection to report — the only gate is is_admin(), applied the same way RLS
-- itself gates a denied SELECT throughout this codebase: silently zero rows,
-- not an error. A coach absent from the result (because it has zero
-- qualifying slots, OR because the caller isn't an admin) is handled
-- identically by the client: default to 0 hours.
--
-- ── unit: decimal hours (e.g. 1.5), not minutes ──
-- Matches how the stat reads on the card ("1.5 hrs"), and avoids a second
-- unit conversion in the client.
-- ============================================================================

create or replace function public.coach_hours_coached()
  returns table (coach_id text, hours numeric)
  language sql
  security definer
  set search_path = ''
  stable
as $$
  select s.coach_id,
         sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)::numeric as hours
  from public.session_slots s
  where (select public.is_admin())
    and s.status = 'published'
    and s.ends_at <= now()
    and exists (
      select 1 from public.bookings b
      where b.slot_id = s.id and b.status = 'attended'
    )
  group by s.coach_id
$$;

revoke all on function public.coach_hours_coached() from public;
grant execute on function public.coach_hours_coached() to authenticated;
