-- ============================================================================
-- owner_cancellation — tell the owners when a player drops out of a session.
--
-- The symmetric half of 044's owner_booking: the academy is pinged when a seat is
-- taken, so it should be pinged when one is given back. Same recipients (the
-- players.is_owner flag), same helper (tpa.notify_owners), same Cairo time helper
-- (tpa.cairo_time_short), same actor-excluded fan-out.
--
-- ── which cancel path, and why only one ──
-- There are four ways a booking becomes cancelled:
--   cancel_booking   — the PLAYER cancels their own seat        → notifies (here)
--   remove_booking   — an ADMIN removes a player from a session → does NOT
--   cancel_session   — an ADMIN cancels the whole session       → does NOT
--   delete_account   — the cascade over a leaving player's seats→ does NOT
-- The last three are the academy's own actions (or a consequence of one), and 044
-- already set this precedent: book_slot notifies, admin_book_player doesn't —
-- there's no point telling the academy what the academy just did. The
-- delete-account cascade would additionally fire once PER booking, turning one
-- account deletion into a burst of pings.
--
-- That scoping is STRUCTURAL, not a rule anyone has to remember: the other three
-- functions each run their own inline `update bookings … + tpa.free_slot_seat`
-- rather than calling public.cancel_booking, so none of them can reach the emit
-- below even by accident.
--
-- ── strictly additive ──
-- cancel_booking is reproduced in full (create or replace needs the whole body) but
-- is BYTE-IDENTICAL to 20260817000036_session_reopened_notify.sql apart from two
-- new declares and one perform before the success return. The lock order (slot then
-- booking), the ownership/status/past guards, the 5h refund decision, free_slot_seat,
-- the confirmed→pending revert and its session_reopened fan-out, and every
-- {ok,reason} are untouched. Proven by diff (insertions only) and by re-running the
-- concurrency suite A–N.
--
-- ── no client change is required ──
-- The push carries its own title and body: the notifications_send_push trigger hands
-- send-push a row id, and send-push forwards `title`/`body` verbatim with no
-- per-type logic, so a brand-new type needs no Edge Function redeploy and no app
-- build. The owners get the push immediately, on whatever version they're running.
-- The only thing a client entry would add is the icon beside it in the in-app
-- notifications list (an unmapped type renders the row with no icon — it does not
-- crash), which is why this emit deliberately passes NO slot id: see the note at the
-- call site.
-- ============================================================================

-- ── the new type ──────────────────────────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened', 'news_published',
    'owner_credit_request', 'owner_booking', 'owner_cancellation'));

-- ── cancel_booking — unchanged except the ping on the success return ──────────
create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player        text;
  v_slot_id       text;
  v_booking       public.bookings;
  v_slot          public.session_slots;
  v_refund        boolean;
  v_was_confirmed boolean;
  v_new_count     int;
  v_new_capacity  int;
  v_who           text;   -- ADDITIVE (owner ping)
  v_coach         text;   -- ADDITIVE (owner ping)
begin
  v_player := public.current_player_id();
  if v_player is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- lock slot first
  if not found then return jsonb_build_object('ok', false, 'reason', 'slot_missing'); end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;   -- then the booking
  if v_booking.player_id <> v_player then return jsonb_build_object('ok', false, 'reason', 'not_owner');         end if;
  if v_booking.status = 'cancelled'  then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;
  if v_booking.status <> 'booked'    then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;
  if v_slot.starts_at <= now()       then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;

  v_refund := (v_slot.starts_at - now()) > tpa.cancellation_window();

  -- NEW — captured from the PRE-cancel locked row, before free_slot_seat runs.
  v_was_confirmed := (v_slot.booked_count >= v_slot.capacity) or (v_slot.manually_confirmed_at is not null);

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
  if v_refund then perform tpa.refund_booking(v_booking.id); end if;

  -- NEW — read the COMMITTED post-cancel state (still under this transaction's
  -- own slot lock, so this is our own just-applied free_slot_seat write, not a
  -- pre-lock peek). manually_confirmed_at is never touched by free_slot_seat,
  -- so v_slot's copy is still accurate for that column.
  select booked_count, capacity into v_new_count, v_new_capacity
    from public.session_slots where id = v_slot.id;

  if v_was_confirmed and v_new_count < v_new_capacity and v_slot.manually_confirmed_at is null then
    perform tpa.notify(
      b.player_id, 'session_reopened', 'Session reopened',
      'A player left your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' — it''s pending again until it fills.',
      v_slot.id, null)
    from public.bookings b
    where b.slot_id = v_slot.id and b.status = 'booked' and b.player_id <> v_player;
  end if;

  -- ── ADDITIVE: tell the owners someone dropped out ────────────────────────
  -- Emitted only here, on the success return, AFTER the seat is freed, the booking
  -- is marked cancelled, any refund is applied and the session_reopened fan-out has
  -- run. Every rejection above returns earlier and notifies nobody.
  --
  -- Scoped to the PLAYER self-cancel by construction: remove_booking, cancel_session
  -- and delete_account each do their own inline seat-free rather than calling this
  -- function, so an academy-initiated cancel or a delete-account cascade cannot reach
  -- this line. Same player-action-only scoping 044 applied to book_slot (which
  -- notifies, while admin_book_player does not).
  --
  -- v_slot is the row locked at the top; free_slot_seat touches booked_count only, so
  -- starts_at and coach_id are still correct here.
  select name into v_who from public.players where id = v_player;
  select name into v_coach from public.coaches where id = v_slot.coach_id;
  perform tpa.notify_owners(
    'owner_cancellation',
    'Booking cancelled',
    coalesce(v_who, 'A player') || ' cancelled ' || tpa.cairo_time_short(v_slot.starts_at)
      || ' slot with ' || coalesce(split_part(v_coach, ' ', 1), 'a coach'),
    v_player,
    -- NO slot id, deliberately. The owner has no booking on this slot, and every
    -- SHIPPED build routes an unrecognised notification type to
    -- Sessions?focus=<slotId> — which would open on a session that isn't theirs.
    -- Passing null makes that fallback a harmless Sessions landing instead.
    null);

  return jsonb_build_object('ok', true, 'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end);
end;
$$;

revoke all on function public.cancel_booking(text) from public;
grant execute on function public.cancel_booking(text) to authenticated;
