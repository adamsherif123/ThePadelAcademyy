-- ============================================================================
-- 068 — the refund-required state, spelled in words the shipped apps know.
--
-- 067 invented purchases.status = 'refund_required'. The independent review
-- found that 1.2 (99541ff) and 1.3 (255b73f) both do
--
--     const status = STATUS_META[purchase.status];     purchase-history.tsx:113
--     <Badge label={status.label} tone={status.tone} />
--
-- with a Record of exactly succeeded|pending|failed and NO fallback, so an
-- unknown status threw a TypeError mid-render and left Purchase History
-- permanently broken for that player. Those builds can never be updated — there
-- is no expo-updates in the repo and no OTA path — so the schema has to speak
-- their vocabulary.
--
-- The state is now: status = 'failed', paid = true, refund_required_at = now().
--   * 'failed' is one of the three statuses they already render ("Failed", red).
--   * paid stays TRUE because the card really was charged.
--   * refund_required_at carries the fact the owner acts on.
--   * every admin revenue figure is `status = 'succeeded' AND paid`
--     (apps/admin/src/data/dashboard.ts:42,49), so this still cannot be counted
--     as collected money — the property 067 wanted, kept.
--
-- 067's two NEW notification types go the same way, for the same reason: neither
-- is in the legacy ICON maps and neither is routed by their deepLink.ts, so they
-- drew a blank glyph and opened the wrong screen. Both are replaced by existing
-- types those apps already handle, and dropped from the CHECK so nothing reaches
-- for them again.
-- ============================================================================

-- ── 1. the columns ──────────────────────────────────────────────────────────
alter table public.purchases add column refund_required_at timestamptz;
alter table public.purchases add column refunded_at        timestamptz;

comment on column public.purchases.refund_required_at is
  'Set (068) when the gateway captured money that could not be turned into credits — today only a second free trial. The row is status=failed, paid=true.';
comment on column public.purchases.refunded_at is
  'Set (068) by mark_purchase_refunded once an owner has actually refunded it in Paymob. Requires refund_required_at.';

-- ── 2. convert anything 067 already parked, BEFORE the CHECK is narrowed ────
do $$
declare v_n integer;
begin
  update public.purchases
     set status = 'failed', paid = true, refund_required_at = coalesce(refund_required_at, now())
   where status = 'refund_required';
  get diagnostics v_n = row_count;
  raise notice '068: converted % refund_required purchase(s) to failed+paid+refund_required_at', v_n;
end $$;

alter table public.purchases drop constraint purchases_status_check;
alter table public.purchases add constraint purchases_status_check
  check (status in ('pending', 'succeeded', 'failed'));

-- The shape rules. refund_required_at only ever describes captured-but-undelivered
-- money, and a refund can only be recorded against something that needed one.
alter table public.purchases add constraint purchases_refund_required_shape
  check (refund_required_at is null or (status = 'failed' and paid));
alter table public.purchases add constraint purchases_refunded_needs_required
  check (refunded_at is null or refund_required_at is not null);

-- GRANTS: purchases is granted INSERT, SELECT to `authenticated` at TABLE level
-- with no column-level grants, so both new columns are READABLE by their owner
-- through purchases_select_own_or_admin and by nobody else. There is no UPDATE
-- grant for any client, so neither column is writable outside a SECURITY DEFINER
-- RPC — the INSERT policy pins status='pending' and paid=false, which the
-- refund_required_at CHECK (status='failed' and paid) makes unsatisfiable at
-- insert time anyway. Asserted in pgTAP.

-- ── 3. the notification types 067 added are withdrawn ───────────────────────
-- Any row 067 already wrote is remapped to the type the legacy apps render, so
-- no existing notification is orphaned by the narrower CHECK below.
update public.notifications set type = 'credits_granted'      where type = 'credits_transferred';
update public.notifications set type = 'owner_credit_request' where type = 'owner_refund_required';

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session', 'session_rescheduled',
    'credits_granted', 'credit_request_rejected', 'admin_booked', 'session_reopened',
    'news_published', 'owner_credit_request', 'owner_booking', 'owner_cancellation',
    'session_reminder', 'booking_confirmation', 'coach_booking_alert', 'coach_session_reminder'
  ));

-- ── 4. a correction to 067's own commentary (review finding #6) ─────────────
-- 067 says of transfer_credit_batch's decrement that the guarded UPDATE "is what
-- actually decides, under the row lock", and guards against "a racer that got
-- here on a stale read". That undersells it and mis-describes the mechanism:
-- with SELECT ... FOR UPDATE taken first there are no stale reads at all, and the
-- second `if not found` branch is unreachable. The review mutated the function to
-- check, and the truth is stronger — FOR UPDATE and the guarded predicate are
-- EACH INDEPENDENTLY SUFFICIENT. Remove the lock and the predicate still
-- serialises; remove the predicate and the lock still does. 067 is applied to dev
-- and is never edited, so the correction lives here.

-- ── 5. settle_purchase: park as failed+paid+refund_required_at ─────────────
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
  v_pkg_name   text;                -- ADDITIVE (068)
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
    -- ADDITIVE (068): 'failed' + paid + refund_required_at, NOT a new status.
    -- 067 invented status='refund_required'; the 1.2 and 1.3 apps index
    -- STATUS_META[purchase.status] with no fallback (purchase-history.tsx:113 in
    -- both), so an unknown status threw and their Purchase History screen was
    -- permanently broken. Those builds can never be updated, so the state has to
    -- be spelled in words they already know. 'failed' is one of the three they
    -- have, it reads as "you got nothing" (true), and every revenue sum in the
    -- admin is `status = 'succeeded' AND paid`, so it still cannot count as money
    -- collected. paid stays TRUE because the card really was charged, and
    -- refund_required_at is what the owner works from.
    update public.purchases
       set status = 'failed', paid = true, refund_required_at = now()
     where id = p_purchase_id;
    select name into v_who from public.players where id = v_pu.player_id;
    select name into v_pkg_name from public.packages where id = v_pu.package_id;
    -- ADDITIVE (068): owner_credit_request, not the 067 type. Same reason as
    -- above: 'owner_refund_required' is in neither legacy ICON map, so it drew a
    -- blank icon, and neither deepLink.ts routed it, so tapping the refund alert
    -- opened Sessions instead of the notifications centre where the message is.
    -- owner_credit_request is already 'cash-outline' and already routes to
    -- /notifications in both (notifications.tsx:26, deepLink.ts:26).
    perform tpa.notify_owners(
      'owner_credit_request',
      'Refund required',
      -- amount is piastres; an owner alert about a refund is the wrong place to
      -- make someone divide by 100.
      coalesce(v_who, 'A player') || ' paid '
        || trim(to_char(v_pu.amount / 100.0, 'FM99999990.00')) || ' EGP'
        || ' for ' || coalesce(v_pkg_name, 'a second trial')
        || '. The payment went through but no credits could be issued (their free'
        || ' trial was already used) — refund it in Paymob.',
      null, null);
    -- ok:true because the webhook's job IS done: the payment is recorded and the
    -- owners are told. ok:false would make paymob-webhook log 'rpc_refused' and,
    -- worse, suggest the row still needs settling.
    return jsonb_build_object('ok', true, 'already_settled', false,
                              'credit_batch_id', null, 'refund_required', true);
    -- still ok:true — paymob-webhook treats that as handled and 200s, which is
    -- correct: the payment IS recorded and the owners ARE told.
  end;

  return jsonb_build_object('ok', true, 'already_settled', false, 'credit_batch_id', v_batch_id);
end;
$fn$;

-- ── 6. fail_purchase: a refund-required row reports cleanly ────────────────
create or replace function public.fail_purchase(p_purchase_id text, p_gateway_transaction_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_status text;
  v_rr     timestamptz;   -- ADDITIVE (068)
begin
  select status, refund_required_at into v_status, v_rr
    from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;

  -- Guarded fail: only a PENDING purchase advances (and only once). We record the
  -- gateway transaction id even on a decline — the ledger tells the whole truth.
  update public.purchases
    set status = 'failed', gateway_transaction_id = p_gateway_transaction_id
    where id = p_purchase_id and status = 'pending';
  if not found then
    -- Already terminal. A redelivered decline is a no-op; a succeeded purchase is
    -- NEVER flipped to failed (terminal-state rule) — and no credits are touched.
    if v_status = 'failed' then
      return jsonb_build_object('ok', true, 'already_failed', true,
                                'refund_required', v_rr is not null);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_succeeded');
  end if;

  -- No mint. Ever. A decline produces no credits.
  return jsonb_build_object('ok', true, 'already_failed', false);
end;
$fn$;

-- ── 7. set_purchase_paid: says WHY, and refuses to toggle a held payment ───
create or replace function public.set_purchase_paid(p_purchase_id text, p_paid boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_status text;
  v_paid   boolean;
  v_rr     timestamptz;   -- ADDITIVE (068)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_paid is null then return jsonb_build_object('ok', false, 'reason', 'invalid_paid'); end if;

  select status, paid, refund_required_at into v_status, v_paid, v_rr
    from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;
  -- ADDITIVE (068): answer BEFORE not_succeeded. A refund-required row is 'failed'
  -- and would otherwise come back as not_succeeded, which tells the owner nothing
  -- about why. Its paid flag is not theirs to toggle: it records that the gateway
  -- captured the money, and that stays true until the money is given back — which
  -- is mark_purchase_refunded's job, not this one's.
  if v_rr is not null then return jsonb_build_object('ok', false, 'reason', 'refund_required'); end if;
  if v_status <> 'succeeded' then return jsonb_build_object('ok', false, 'reason', 'not_succeeded'); end if;

  if v_paid = p_paid then
    return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', false);
  end if;

  update public.purchases set paid = p_paid where id = p_purchase_id;
  return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', true);
end;
$fn$;

-- ── 8. transfer_credit_batch: a notification type the legacy apps render ───
create or replace function public.transfer_credit_batch(p_batch_id text, p_to_location_id text, p_quantity integer, p_note text)
  returns jsonb
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

  -- ADDITIVE (068): credits_granted, not 067's 'credits_transferred'. The 1.2 and
  -- 1.3 apps can never be updated, and neither has that type: their ICON map
  -- (notifications.tsx:21) would draw a blank glyph and notificationHref would
  -- fall through to Sessions. credits_granted is already 'wallet-outline' in both
  -- and already deep-links to /wallet (deepLink.ts:23) — which is exactly where a
  -- player should land to see credits that just appeared at another branch. The
  -- body still says they were MOVED, so nothing is misrepresented.
  perform tpa.notify(
    v_batch.player_id, 'credits_granted', 'Credits moved',
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


-- ── 9. mark_purchase_refunded ───────────────────────────────────────────────
-- The exit the review found missing: once an owner has refunded in Paymob there
-- was no way to say so, and a Session 6 queue of `refund_required` rows would
-- only ever grow.
--
-- The note goes in purchases.gateway_transaction_id? No — that is the gateway's
-- own id and overwriting it would destroy the reconciliation trail. It goes in
-- credit_requests? There is no request here. So the note is recorded where every
-- other admin note in this schema lives when it belongs to no row of its own: as
-- an owner-visible notification, emitted at the moment of the refund with the
-- admin's words in the body. The DATE is the queryable fact (refunded_at); the
-- note is the human account of it, and notifications are already the place this
-- app keeps those.
--
-- No player notification. The 1.2/1.3 apps have no type that means "you were
-- refunded": credits_granted deep-links to a wallet that will show nothing new,
-- and credit_request_rejected is about a request they never made. Telling them
-- nothing is better than telling them something those builds render wrongly —
-- and the player already saw "Payment didn't go through" at the time.
create or replace function public.mark_purchase_refunded(p_purchase_id text, p_note text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_pu    public.purchases;
  v_who   text;
  v_admin text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_note is null or btrim(p_note) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  -- FOR UPDATE so two owners clicking "refunded" at once cannot both record it;
  -- the loser re-reads under the lock and sees refunded_at already set.
  select * into v_pu from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;
  if v_pu.refund_required_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_refund_required');
  end if;
  if v_pu.refunded_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_refunded',
                              'refunded_at', v_pu.refunded_at);
  end if;

  update public.purchases set refunded_at = now() where id = p_purchase_id;

  select name into v_who from public.players where id = v_pu.player_id;
  select display_name into v_admin from public.admins
   where auth_user_id = (select auth.uid());

  perform tpa.notify_owners(
    'owner_credit_request',
    'Refund recorded',
    coalesce(v_admin, 'An admin') || ' recorded a refund of '
      || trim(to_char(v_pu.amount / 100.0, 'FM99999990.00')) || ' EGP to '
      || coalesce(v_who, 'a player') || ' — ' || btrim(p_note),
    null, null);

  return jsonb_build_object('ok', true, 'refunded_at', now());
end;
$fn$;

revoke all on function public.mark_purchase_refunded(text, text) from public, anon, authenticated;
grant execute on function public.mark_purchase_refunded(text, text) to authenticated;

comment on function public.mark_purchase_refunded(text, text) is
  'Admin-only (068): records that a refund-required purchase has actually been refunded in Paymob. The note is emitted as an owner notification; refunded_at is the queryable fact.';
