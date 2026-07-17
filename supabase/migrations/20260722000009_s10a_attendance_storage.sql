-- ============================================================================
-- S10a — the missing backend the admin (S10b) will wire against:
--   1. mark_attendance(booking_id, status) — the attendance RPC.
--   2. the coach-photos Storage bucket + its policies.
-- Backend only. Touches no existing policy; adds one RPC and one bucket.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — mark_attendance(booking_id, status) — ADMIN.
--
-- Attendance is NOT money-equivalent: the credit is spent at booking time, and
-- attended vs no_show leaves it spent either way (S7b). So this never mints or
-- refunds, and never moves booked_count — booked_count counts NON-cancelled
-- bookings (S7a), and attended/no_show are non-cancelled, so a past 4/4 session
-- stays 4/4.
--
-- Why an RPC and not a column grant on bookings.status: a grant would let the admin
-- write 'cancelled' directly, bypassing the refund + seat-free path entirely (a
-- cancelled booking still holding its seat, no credit returned, booked_count wrong).
-- The RPC is the choke point that makes 'cancelled' UNREACHABLE from here — it is
-- simply not in the accepted set, so remove_booking / cancel_booking stay the only
-- doors to a cancelled booking.
--
-- Reversible by design (S4f: "click the active state again"): 'booked' is an
-- accepted target, so attended → booked and no_show → booked both work. Idempotent:
-- re-marking the same state is a no-op success. Past sessions only: marking a
-- session that hasn't started is meaningless and pre-judging a booked player a
-- no_show is nonsense, so it's enforced here (server-side), not just in the UI.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_attendance(p_booking_id text, p_status text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_booking   public.bookings;
  v_starts_at timestamptz;
begin
  -- Admin only — same {ok, reason} shape as every other admin RPC.
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- The accepted set. 'cancelled' is deliberately absent, so it can never be
  -- written through this door — that is the whole reason this is an RPC.
  if p_status not in ('attended', 'no_show', 'booked') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  -- Lock the booking row. This serialises with remove_booking / cancel_booking /
  -- cancel_session (all of which lock the booking FOR UPDATE), so marking can never
  -- overwrite a concurrent cancellation and resurrect a refunded, seat-freed seat.
  -- We never take the slot lock, so there is no cycle with the slot-first cancels.
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'booking_missing');
  end if;

  -- You cannot un-cancel by marking someone present: that would resurrect a booking
  -- whose seat was freed and whose credit may have been refunded.
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;

  -- Past sessions only (by the DB clock). A plain read — no slot lock.
  select starts_at into v_starts_at from public.session_slots where id = v_booking.slot_id;
  if v_starts_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'session_not_started');
  end if;

  -- The ONLY write: bookings.status. Never session_slots.booked_count, never
  -- credit_batches. cancelled_at stays null (the target is never 'cancelled'), so
  -- the bookings_cancelled_at_shape CHECK holds for all three targets.
  update public.bookings set status = p_status where id = p_booking_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- Authenticated players only (the body enforces is_admin); never anon.
revoke all on function public.mark_attendance(text, text) from public;
grant execute on function public.mark_attendance(text, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — the coach-photos Storage bucket + policies.
--
-- PUBLIC bucket. Coach headshots render in the client app (players read coaches
-- through RLS, and coaches are already public-readable); a headshot on a public
-- academy site is not a secret. Public read is the honest classification: simpler
-- and CDN-cacheable, with no signed-URL expiry churn for zero security gain.
--
-- WRITE is admin-only — the same authority model as coach CRUD. A player cannot
-- upload, replace, or delete anything.
--
-- Limits: 5 MiB and image/* only (jpeg/png/webp), enforced by the bucket config at
-- the Storage API, so a 40 MB or non-image upload is rejected before it lands.
--
-- Path convention (for S10b): coaches/<coachId>.<ext>, uploaded with upsert. A
-- deterministic per-coach key means replacing a photo OVERWRITES the same object —
-- no orphaned files accumulating a silent storage bill. (A content-hashed key would
-- orphan the old file on every change; that's the anti-pattern here.) The one caveat
-- is a changed extension (jpg→png leaves the old key): S10b should normalise to a
-- single extension or delete coaches/<coachId>.* before writing. All coach photos
-- live under the coaches/ prefix, which the write policies below pin.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'coach-photos',
  'coach-photos',
  true,
  5242880,                                             -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Read: anyone (anon + authenticated). Public bucket already serves via the CDN;
-- this also allows API-level reads (list/download) for the same audience.
create policy "coach photos are readable by anyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'coach-photos');

-- Write (insert / update / delete): admin only, scoped to the bucket. update is
-- needed so an upsert can overwrite; delete so a photo can be replaced/removed.
create policy "coach photos are insertable by admins"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'coach-photos' and public.is_admin());

create policy "coach photos are updatable by admins"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'coach-photos' and public.is_admin())
  with check (bucket_id = 'coach-photos' and public.is_admin());

create policy "coach photos are deletable by admins"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'coach-photos' and public.is_admin());
