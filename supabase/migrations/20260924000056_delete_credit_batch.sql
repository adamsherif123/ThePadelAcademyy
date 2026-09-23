-- ============================================================================
-- Admin: delete a credit batch, and the purchase/request behind it.
--
-- This is the undo for a mis-entered payment. The owner records a cash purchase
-- for the wrong player, or approves a credit request twice, and today there is no
-- way back: grant_credits and record_cash_purchase only ever ADD, and there is no
-- admin DELETE policy on any money table. The correction has to happen in the SQL
-- editor, by hand, in the right order — which is exactly the operation that should
-- not be done by hand on production money.
--
-- What one call removes, in FK order:
--   1. the credit_requests row whose purchase this is  (if there is one)
--   2. the credit_batches row itself
--   3. the purchases row behind it                     (if there is one, and if
--      nothing else still points at it)
-- A grant (admin_grant / signup_grant) has no purchase and no request, so for
-- those, step 2 is the whole job.
--
-- ── why bookings REFUSE the delete rather than cascade ──
-- bookings.credit_batch_id is NOT NULL, so a batch that has ever been spent
-- against cannot be deleted without deleting the bookings too — and those are
-- attendance history, which is what coach hours are computed from. Deleting a
-- batch would silently rewrite what a coach is owed. So any booking at all, of
-- ANY status, blocks: a cancelled booking still refunded its credit, so
-- quantity_remaining = quantity_total does NOT mean the batch is untouched.
-- The FK would raise 23503 regardless; the guard turns that into a reason the
-- admin can read, and names the count so they know what they are looking at.
--
-- ── this really does remove revenue ──
-- Deleting a succeeded purchase takes it out of the Dashboard's revenue, because
-- revenue is summed from purchases. That is the intent — a purchase recorded in
-- error was never revenue — but it is the reason this is admin-only, one batch at
-- a time, with no bulk form anywhere near it.
-- ============================================================================

create or replace function public.delete_credit_batch(p_batch_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_batch       public.credit_batches;
  v_bookings    integer;
  v_purchase_id text;
  v_other       integer;
  v_requests    integer := 0;
  v_purchases   integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- FOR UPDATE, not a bare select: book_slot spends a credit with a guarded
  -- UPDATE on this same row, so holding its lock for the length of this function
  -- is what stops a booking being inserted between the count below and the
  -- delete. A racer blocked here finds the row gone and fails cleanly on its own
  -- guard rather than orphaning a booking.
  select * into v_batch from public.credit_batches where id = p_batch_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'batch_missing');
  end if;

  select count(*) into v_bookings from public.bookings where credit_batch_id = p_batch_id;
  if v_bookings > 0 then
    return jsonb_build_object('ok', false, 'reason', 'batch_has_bookings', 'bookings', v_bookings);
  end if;

  v_purchase_id := v_batch.purchase_id;

  -- The three deletes are one unit: if any FK still holds, NOTHING comes out.
  -- The handler is the same belt-and-braces delete_package uses — the count above
  -- plus the row lock should already have caught it, so reaching here means some
  -- future table started referencing one of these rows, and refusing is the only
  -- safe answer.
  begin
    -- 1. the claim that produced the purchase. Deleted before the purchase it
    --    points at, or the FK refuses.
    if v_purchase_id is not null then
      delete from public.credit_requests where purchase_id = v_purchase_id;
      get diagnostics v_requests = row_count;
    end if;

    -- 2. the batch.
    delete from public.credit_batches where id = p_batch_id;

    -- 3. the purchase — but only once nothing else hangs off it. One purchase
    --    mints exactly one batch today (tpa.mint_credits_for_purchase), so this is
    --    belt and braces; if that ever stops being true, the other batch keeps its
    --    purchase instead of losing it out from under itself.
    if v_purchase_id is not null then
      select count(*) into v_other from public.credit_batches where purchase_id = v_purchase_id;
      if v_other = 0 then
        delete from public.purchases where id = v_purchase_id;
        get diagnostics v_purchases = row_count;
      end if;
    end if;
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'batch_in_use');
  end;

  return jsonb_build_object(
    'ok', true,
    'deleted_requests', v_requests,
    'deleted_purchases', v_purchases
  );
end;
$$;

comment on function public.delete_credit_batch(text) is
  'Admin-only. Removes a credit batch plus its purchase and credit request. Refuses if any booking was made against the batch.';

-- Same authorisation shape as every other admin money RPC (S7b): EXECUTE to
-- authenticated, authority enforced by the is_admin() gate in the body.
revoke all on function public.delete_credit_batch(text) from public, anon;
grant execute on function public.delete_credit_batch(text) to authenticated;
