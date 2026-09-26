-- ============================================================================
-- 067 — credit transfer between branches, and the trial settle race.
--
-- PART A. An owner can move a player's REMAINING credits from one branch to
-- another as goodwill. A transfer is not revenue and not a new entitlement: it
-- keeps the original expiry, keeps the training type, and takes quantity out of
-- the source batch before it puts it into the new one, so the player's total
-- never changes.
--
-- PART B. Two trial checkouts can both be opened before either is paid — 066's
-- policy can only see the state at insert time. Both then settle, and the second
-- mint hit credit_batches_one_trial_purchase_per_player and RAISED out of
-- settle_purchase: money captured, purchase left pending, no credits, no alert
-- anyone would see. Captured money has to be recorded even when the thing it
-- bought cannot be delivered.
-- ============================================================================

-- ── A1. 'transfer' as a credit source ───────────────────────────────────────
alter table public.credit_batches drop constraint credit_batches_source_check;
alter table public.credit_batches add constraint credit_batches_source_check
  check (source in ('purchase', 'signup_grant', 'admin_grant', 'transfer'));

-- Where the credits came from. Self-referential, so a batch's provenance is one
-- hop away and delete_credit_batch can see children before it removes a parent.
alter table public.credit_batches
  add column transferred_from text references public.credit_batches(id);

alter table public.credit_batches add constraint credit_batches_transfer_link
  check ((source = 'transfer') = (transferred_from is not null));

-- The note rule gains a third case. It used to be "a note only ever belongs to an
-- admin grant"; a transfer must CARRY one, because a credit that moved branch
-- without a stated reason is indistinguishable from a mistake.
alter table public.credit_batches drop constraint credit_batches_note_admin_only;
alter table public.credit_batches add constraint credit_batches_note_shape
  check (
    case source
      when 'admin_grant' then true              -- optional (grant_credits requires one itself)
      when 'transfer'    then note is not null  -- REQUIRED
      else note is null                          -- purchase / signup_grant carry none
    end
  );

comment on column public.credit_batches.transferred_from is
  'The batch these credits were moved out of (067). Set iff source = ''transfer''.';

-- GRANTS: credit_batches is granted SELECT to `authenticated` at TABLE level, not
-- per column, so transferred_from is readable by its owner through the existing
-- credit_batches_select_own_or_admin policy with no new grant. Nothing holds
-- INSERT or UPDATE on this table — every write goes through a SECURITY DEFINER
-- RPC — so there is no write surface to widen either. Verified in pgTAP.

-- ── A2. the notification type ───────────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session', 'session_rescheduled',
    'credits_granted', 'credit_request_rejected', 'admin_booked', 'session_reopened',
    'news_published', 'owner_credit_request', 'owner_booking', 'owner_cancellation',
    'session_reminder', 'booking_confirmation', 'coach_booking_alert', 'coach_session_reminder',
    -- ADDITIVE (067)
    'credits_transferred',   -- to the player: their credits now live at another branch
    'owner_refund_required'  -- to the owners: money captured that must be given back
  ));

-- ── A3. transfer_credit_batch ───────────────────────────────────────────────
create or replace function public.transfer_credit_batch(
  p_batch_id        text,
  p_to_location_id  text,
  p_quantity        integer,
  p_note            text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_batch    public.credit_batches;
  v_loc      public.locations;
  v_new_id   text := 'cb_' || gen_random_uuid();
  v_player   public.players;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_note is null or btrim(p_note) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('ok', false, 'reason', 'quantity_below_one');
  end if;

  -- LOCK ORDER. book_slot takes the credit_batches row first (its guarded
  -- decrement) and only then inserts the booking. This function does the same:
  -- the source batch row is the FIRST thing locked, and the child batch is
  -- inserted after. Both money paths therefore queue on the same row in the same
  -- order, so a transfer racing a booking cannot deadlock — one simply waits.
  -- Concurrency scenarios R and S hold this.
  select * into v_batch from public.credit_batches where id = p_batch_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'batch_missing'); end if;

  if v_batch.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_player from public.players where id = v_batch.player_id;
  if not found or v_player.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;

  if p_to_location_id = v_batch.location_id then
    return jsonb_build_object('ok', false, 'reason', 'same_location');
  end if;

  select * into v_loc from public.locations where id = p_to_location_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'location_missing'); end if;
  if not v_loc.is_active then return jsonb_build_object('ok', false, 'reason', 'location_inactive'); end if;

  -- Read-then-check is only an early, friendly answer; the guarded UPDATE below
  -- is what actually decides, under the row lock.
  if p_quantity > v_batch.quantity_remaining then
    return jsonb_build_object('ok', false, 'reason', 'quantity_above_remaining',
                              'remaining', v_batch.quantity_remaining);
  end if;

  -- The conditional decrement. Same shape as book_slot's: the predicate repeats
  -- the quantity test so a racer that got here on a stale read takes nothing.
  update public.credit_batches
     set quantity_remaining = quantity_remaining - p_quantity
   where id = p_batch_id and quantity_remaining >= p_quantity;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'quantity_above_remaining',
                              'remaining', (select quantity_remaining
                                              from public.credit_batches where id = p_batch_id));
  end if;

  -- The child. Same player, same training type, SAME expiry — a transfer is a
  -- move, not a renewal, so it can never be used to quietly extend a credit's
  -- life. quantity_total = the moved amount, so "how many were moved" stays
  -- legible after some of them are spent.
  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining,
     expires_at, created_at, note, location_id, transferred_from)
  values
    (v_new_id, v_batch.player_id, 'transfer', null, v_batch.training_type, p_quantity, p_quantity,
     v_batch.expires_at, now(), btrim(p_note), p_to_location_id, p_batch_id);

  perform tpa.notify(
    v_batch.player_id, 'credits_transferred', 'Credits moved',
    p_quantity || ' ' || initcap(v_batch.training_type) || ' credit'
      || case when p_quantity = 1 then '' else 's' end
      || ' moved to ' || tpa.location_name(p_to_location_id) || '.',
    null, null);

  return jsonb_build_object('ok', true, 'credit_batch_id', v_new_id,
                            'from_location_id', v_batch.location_id,
                            'to_location_id', p_to_location_id,
                            'quantity', p_quantity);
end;
$fn$;

revoke all on function public.transfer_credit_batch(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.transfer_credit_batch(text, text, integer, text) to authenticated;

comment on function public.transfer_credit_batch(text, text, integer, text) is
  'Admin-only goodwill move of remaining credits to another branch (067). Never extends expiry, never creates revenue, never edits the source batch''s location.';

-- ── A4. delete_credit_batch refuses a batch with transfer children ──────────
create or replace function public.delete_credit_batch(p_batch_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_batch       public.credit_batches;
  v_bookings    integer;
  v_purchase_id text;
  v_other       integer;
  v_requests    integer := 0;
  v_purchases   integer := 0;
  v_transfers   integer;   -- ADDITIVE (067)
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

  -- ADDITIVE (067): REFUSE rather than detach. The transferred_from FK would
  -- already stop this delete and the handler below would call it 'batch_in_use',
  -- which tells the owner nothing; this says which thing is in the way, the same
  -- way batch_has_bookings does.
  --
  -- Refuse, not detach, because detaching is the destructive option dressed up as
  -- the gentle one: the child's quantity and expiry were both derived from this
  -- batch, so cutting the link leaves spendable credits whose provenance is gone.
  -- An owner deleting a batch is almost always saying "this grant was a mistake",
  -- and if it was, the credits moved out of it are a mistake too. Making them
  -- delete the child first keeps that decision explicit and the ledger readable.
  select count(*) into v_transfers from public.credit_batches where transferred_from = p_batch_id;
  if v_transfers > 0 then
    return jsonb_build_object('ok', false, 'reason', 'batch_has_transfers', 'transfers', v_transfers);
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
$fn$;


-- ── B1. the purchase status that means "paid, and we owe it back" ───────────
-- A distinct STATUS rather than a flag on 'succeeded', because the admin's
-- revenue figures are computed as `status = 'succeeded' AND paid`
-- (apps/admin/src/data/dashboard.ts). Money the academy has to give back must
-- never sit inside collected revenue, and a new status keeps it out of that sum
-- for free, without touching the dashboard. It also keeps set_purchase_paid's
-- not_succeeded guard honest: you cannot mark a refund-required row as paid.
-- Queryable as `select * from purchases where status = 'refund_required'`.
alter table public.purchases drop constraint purchases_status_check;
alter table public.purchases add constraint purchases_status_check
  check (status in ('pending', 'succeeded', 'failed', 'refund_required'));

-- ── B2. settle_purchase no longer raises when the mint is impossible ────────
create or replace function public.settle_purchase(p_purchase_id text, p_gateway_transaction_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_status     text;
  v_batch_id   text;
  v_constraint text;                -- ADDITIVE (067)
  v_pu         public.purchases;    -- ADDITIVE (067)
  v_who        text;                -- ADDITIVE (067)
begin
  select status into v_status from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;

  -- Guarded settle: only a PENDING purchase advances (and only once).
  update public.purchases
    set status = 'succeeded', gateway_transaction_id = p_gateway_transaction_id
    where id = p_purchase_id and status = 'pending';
  if not found then
    -- Already advanced. Redelivery of an already-succeeded webhook → success, no
    -- second mint. A 'failed' purchase can't be settled.
    if v_status = 'succeeded' then return jsonb_build_object('ok', true, 'already_settled', true); end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  -- ADDITIVE (047): a gateway settlement IS collected money — Paymob has already
  -- taken the card payment, so there is nothing for the academy to confirm by hand.
  -- Only reached on the path where the guarded update above actually advanced the
  -- row; the redelivery and not_pending branches return before this line.
  update public.purchases set paid = true where id = p_purchase_id;

  -- ADDITIVE (067): the mint can legitimately fail, and when it does the money
  -- is already gone.
  --
  -- 066 stops a second trial CHECKOUT being opened once the trial is used, but
  -- two can both be opened before either is paid — that policy only sees the
  -- state at insert time. Both then settle, and the second mint violates
  -- credit_batches_one_trial_purchase_per_player. Before this, that violation
  -- escaped the function: Paymob had captured the card payment, the purchase was
  -- left 'pending' with paid=false, no credits existed, and the only trace was a
  -- line in the webhook log.
  --
  -- Caught here rather than pre-checked with tpa.trial_used, because a pre-check
  -- is a read and cannot see a concurrent uncommitted mint — concurrency
  -- scenario T fails against exactly that version. The unique index is the only
  -- thing that actually arbitrates, so the index is what we listen to.
  begin
    v_batch_id := tpa.mint_credits_for_purchase(p_purchase_id);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'credit_batches_one_trial_purchase_per_player' then
      raise;   -- any other collision is a real bug; do not swallow it
    end if;

    -- Captured money is never un-captured by refusing to record it. Keep the
    -- settle (status/paid were set above and survive this subtransaction's
    -- rollback), park the row in a status that means "we hold this and owe it
    -- back", and put it in front of the owners.
    select * into v_pu from public.purchases where id = p_purchase_id;
    update public.purchases set status = 'refund_required' where id = p_purchase_id;
    select name into v_who from public.players where id = v_pu.player_id;
    perform tpa.notify_owners(
      'owner_refund_required',
      'Refund required',
      -- amount is piastres; an owner alert about a refund is the wrong place to
      -- make someone divide by 100.
      coalesce(v_who, 'A player') || ' paid '
        || trim(to_char(v_pu.amount / 100.0, 'FM99999990.00')) || ' EGP'
        || ' for a second trial. The payment went through but no credits could be'
        || ' issued — refund it in Paymob.',
      null, null);
    -- ok:true because the webhook's job IS done: the payment is recorded and the
    -- owners are told. ok:false would make paymob-webhook log 'rpc_refused' and,
    -- worse, suggest the row still needs settling.
    return jsonb_build_object('ok', true, 'already_settled', false,
                              'credit_batch_id', null, 'refund_required', true);
  end;

  return jsonb_build_object('ok', true, 'already_settled', false, 'credit_batch_id', v_batch_id);
end;
$fn$;
