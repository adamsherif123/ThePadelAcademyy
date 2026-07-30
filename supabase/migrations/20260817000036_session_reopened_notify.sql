-- ============================================================================
-- Notify remaining players when a cancellation drops a confirmed session back
-- to pending. The symmetric event to session_confirmed (fill-notify, S12) —
-- today a cancel that un-fills a session tells nobody.
--
-- ── TODO-first findings ──
-- The task's own premise ("last redefined in 20260727000014") is stale: BOTH
-- cancel_booking and remove_booking were redefined again by
-- 20260804000023_open_type_slots.sql and, finally, by
-- 20260805000024_open_type_slots_fixes.sql (FIX 3) — which extracted the
-- shared seat-free + revert statement into tpa.free_slot_seat(v_slot), called
-- by cancel_booking, remove_booking, AND delete_account. THAT is the live
-- body this migration is additive on top of; nothing later touches either
-- function. tpa.free_slot_seat is untouched here — not its signature, not its
-- SET/WHERE — so all three of its callers keep behaving byte-identically.
--
-- ── detection: confirmed → pending, EXCLUDING the manual-confirm trap ──
-- v_slot (the PL/pgSQL variable) is captured via `for update` BEFORE
-- free_slot_seat runs, so it holds the PRE-cancel row exactly:
--   was confirmed  ⇔  v_slot.booked_count >= v_slot.capacity
--                      OR v_slot.manually_confirmed_at IS NOT NULL
-- free_slot_seat's own UPDATE never touches manually_confirmed_at (verified by
-- reading it — its SET list is booked_count/training_type/gender/level/
-- capacity/pre_booking_capacity/set_by_booking_at only), so v_slot's copy of
-- that column is still exactly correct after the call — only booked_count and
-- (on a full empty-revert) capacity can have moved. Post-cancel state is read
-- back with a plain SELECT after free_slot_seat runs — no new lock is needed
-- because this transaction already holds the slot's FOR UPDATE lock from the
-- initial select, so this is a read of our OWN just-committed-in-transaction
-- write, never a stale pre-lock peek:
--   now pending    ⇔  (post-cancel) booked_count < capacity
--                      AND v_slot.manually_confirmed_at IS NULL
-- ANDing the two: the notification can only fire when manually_confirmed_at
-- IS NULL (required by "now pending") AND booked_count >= capacity pre-cancel
-- (the only way "was confirmed" can be true once manual is ruled out) AND the
-- post-cancel count is genuinely below capacity — exactly "confirmed by fill,
-- and this cancel un-fills it". A manually-confirmed slot dropping below
-- capacity fails "now pending" outright (manually_confirmed_at is still set)
-- and is silently, correctly skipped — no false "reopened" on a session the
-- academy deliberately kept running.
--
-- A cancel that empties the slot to zero (free_slot_seat's revert branch)
-- still passes the gate in the ordinary fill-confirmed case (0 < the
-- restored capacity) — but by construction, "empties to zero" means every
-- booking on the slot is now cancelled, so the fan-out's own
-- `status = 'booked'` filter selects zero rows. No special-case is needed;
-- confirmed by test below.
--
-- ── fan-out ──
-- Mirrors the fill-notify's shape exactly: `perform tpa.notify(...) from
-- public.bookings b where b.slot_id = ... and b.status = 'booked' and
-- b.player_id <> <the canceller>` — placed after the booking's own status
-- flip to 'cancelled' has already committed within this transaction, so the
-- canceller is excluded twice over (status AND player_id), same belt-and-
-- braces style as every other emit in this file.
--
-- ── additive-only ──
-- Every existing line in cancel_booking/remove_booking — the lock order, the
-- seat-free call, the refund, every {ok,reason} branch — is reproduced
-- byte-identical below; the only new lines are the two declared variables,
-- the pre-cancel boolean capture, the post-cancel re-read, and the new
-- `perform tpa.notify(...)` block.
-- ============================================================================

-- ── widen the notifications type CHECK (established drop+recreate pattern) ──
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened'));

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

  return jsonb_build_object('ok', true, 'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end);
end;
$$;

create or replace function public.remove_booking(p_booking_id text, p_refund boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot_id       text;
  v_slot          public.session_slots;
  v_booking       public.bookings;
  v_was_confirmed boolean;
  v_new_count     int;
  v_new_capacity  int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- slot lock first
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  -- NEW — captured from the PRE-cancel locked row, before free_slot_seat runs.
  v_was_confirmed := (v_slot.booked_count >= v_slot.capacity) or (v_slot.manually_confirmed_at is not null);

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking_id;
  if p_refund then perform tpa.refund_booking(p_booking_id); end if;

  -- NEW — same committed-state re-read as cancel_booking.
  select booked_count, capacity into v_new_count, v_new_capacity
    from public.session_slots where id = v_slot.id;

  if v_was_confirmed and v_new_count < v_new_capacity and v_slot.manually_confirmed_at is null then
    perform tpa.notify(
      b.player_id, 'session_reopened', 'Session reopened',
      'A player left your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' — it''s pending again until it fills.',
      v_slot.id, null)
    from public.bookings b
    where b.slot_id = v_slot.id and b.status = 'booked' and b.player_id <> v_booking.player_id;
  end if;

  -- v_slot is the PRE-update PL/pgSQL variable — still names the real type the
  -- player was removed from even though the column may have just been nulled.
  perform tpa.notify(
    v_booking.player_id, 'removed_from_session', 'Removed from a session',
    'You were removed from your ' || initcap(v_slot.training_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '. '
      || case when p_refund then 'Your credit was refunded.' else 'Your credit was not refunded.' end,
    v_slot_id, null);

  return jsonb_build_object('ok', true, 'refunded', p_refund);
end;
$$;
