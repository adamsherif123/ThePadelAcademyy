-- ============================================================================
-- S7b.1 — eliminate the money-path deadlock (structurally, not by retry).
--
-- The S7b §8 report flagged a "book_slot ↔ cancel_session" deadlock. Investigating
-- it (supabase/tests/concurrency.sh, and two focused probes) showed that pairing is
-- NOT where the deadlock is: book_slot's guarded `UPDATE session_slots` takes FOR
-- NO KEY UPDATE on the slot row and cancel_session's `SELECT … FOR UPDATE` takes
-- FOR UPDATE — those conflict, so the two SERIALISE on the slot row and can never
-- deadlock on the same slot. (Confirmed: a held book-side slot lock makes the
-- cancel-side FOR UPDATE wait.) The 40P01 in the original report was a misdiagnosed
-- transient; its SQLSTATE was never actually confirmed.
--
-- The REAL, reproducible deadlock is two concurrent cancel_session calls on
-- DIFFERENT slots that refund the SAME credit batches — the same player booked onto
-- both cancelled sessions. cancel_session is the ONLY multi-refund RPC, so it is the
-- only one that holds locks on several credit_batches at once; if two of them
-- acquire an overlapping set in opposite order, they cycle. A slot-scoped advisory
-- lock does NOT help here (the slots are different, so the keys differ), and a
-- retry-on-40P01 would only paper over it. The correct, structural fix is a global
-- lock order on the shared resource: refund in credit_batch_id order, taking each
-- credit lock explicitly in that order, so every cancel_session acquires shared
-- credit locks in the same sequence and no cycle can form.
--
-- The other RPCs (book_slot, admin_book_player, cancel_booking, remove_booking) each
-- touch at most ONE credit batch, so they can never be the two-lock party in a
-- cycle — nothing to order there. Result union is unchanged (S9 unaffected).
-- ============================================================================
create or replace function public.cancel_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot  public.session_slots;
  v_bk    record;
  v_count int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                   return jsonb_build_object('ok', false, 'reason', 'slot_missing');      end if;
  if v_slot.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  -- Deterministic refund order. The outer read takes no row lock (the slot lock held
  -- above keeps this slot's active bookings stable); each iteration then locks the
  -- credit batch EXPLICITLY, in credit_batch_id order. Two concurrent cancels that
  -- share credits therefore lock those shared batches in the same order → no cycle.
  for v_bk in
    select b.id, b.credit_batch_id
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked'
    order by b.credit_batch_id, b.id
  loop
    perform 1 from public.credit_batches where id = v_bk.credit_batch_id for update;
    perform tpa.refund_booking(v_bk.id);
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_bk.id;
    v_count := v_count + 1;
  end loop;

  update public.session_slots set status = 'cancelled', booked_count = 0 where id = p_slot_id;

  return jsonb_build_object('ok', true, 'refunded_count', v_count);
end;
$$;
