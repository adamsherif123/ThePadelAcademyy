-- ============================================================================
-- A3 (rail, part 2) — credit_requests: the report-a-payment / admin-credits rail.
--
-- The player has ALREADY paid out-of-band (InstaPay transfer or cash) before they submit.
-- A request is a CLAIM ("I paid for this package, here's a screenshot"); the admin's
-- approval is the TRUTH — it records what was actually granted (credits, via a real
-- purchase) and what came in (amount). Approval is real revenue, minted through the ONE
-- shared purchase-mint rule, NOT a comp.
--
-- What lives where (table shape decision): the request stays a thin, self-readable claim
-- (player, package, method, proof, status, reject_reason). The GRANTED numbers — amount +
-- credit quantity — live on the linked purchase / credit_batch, which is already the
-- financial record of truth. Storing them twice would let the wallet and the books drift;
-- instead the request LINKS to its purchase_id, and the admin queue joins for the numbers.
-- ============================================================================

-- ── the table ───────────────────────────────────────────────────────────────
create table public.credit_requests (
  id             text primary key,                        -- cr_… supplied by the RPC, no default
  player_id      text not null references public.players (id),
  package_id     text not null references public.packages (id),
  payment_method text not null check (payment_method in ('instapay', 'cash')),  -- never paymob (a gateway)
  proof_path     text,                                     -- Storage key; nullable (cash may have no proof)
  status         text not null check (status in ('pending', 'approved', 'rejected')),
  created_at     timestamptz not null,
  -- resolution fields (set on approve/reject only) ------------------------------
  resolved_at    timestamptz,
  resolved_by    text references public.admins (id),       -- the admin who resolved it
  reject_reason  text,
  purchase_id    text references public.purchases (id),    -- the succeeded purchase minted on approval
  -- Resolution fields set IFF resolved, and each terminal state carries exactly its own:
  -- approved → a purchase and no reason; rejected → a reason and no purchase. Same
  -- discipline as bookings_cancelled_at_shape, across the three-state machine.
  constraint credit_requests_resolution_shape check (
    (status = 'pending'  and resolved_at is null     and resolved_by is null     and purchase_id is null     and reject_reason is null)
    or (status = 'approved' and resolved_at is not null and resolved_by is not null and purchase_id is not null and reject_reason is null)
    or (status = 'rejected' and resolved_at is not null and resolved_by is not null and purchase_id is null     and reject_reason is not null)
  )
);

-- One PENDING request per player (a partial unique index — the signup-grant pattern), so a
-- player can't flood the queue with five. Resolved rows are unconstrained (history accrues).
create unique index credit_requests_one_pending_per_player
  on public.credit_requests (player_id)
  where status = 'pending';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.credit_requests enable row level security;
-- Clear Supabase's default grants on a NEW public table before handing back exactly
-- SELECT + INSERT (the S12 default-grant lesson). NO update/delete to any client role:
-- approval/rejection is money and happens ONLY through the SECURITY DEFINER RPCs below.
revoke all on public.credit_requests from anon, authenticated;
grant select, insert on public.credit_requests to authenticated;

-- Read your own; an admin reads all (the review queue).
create policy credit_requests_select_own_or_admin on public.credit_requests
  for select to authenticated
  using (player_id = (select public.current_player_id()) or (select public.is_admin()));

-- Insert your OWN PENDING request only, every resolution field pinned empty — the
-- purchases_insert_own_pending discipline. The package EXISTS-pin is RLS-filtered (like the
-- purchases amount-pin): an inactive/hidden package is invisible → the subselect is empty →
-- WITH CHECK fails. So even a client bypassing request_credits can't request a hidden or a
-- trial package. (be generous with pins on the money surface — the S5.1 lesson.)
create policy credit_requests_insert_own_pending on public.credit_requests
  for insert to authenticated
  with check (
    player_id = (select public.current_player_id())
    and status = 'pending'
    and resolved_at is null
    and resolved_by is null
    and purchase_id is null
    and reject_reason is null
    and payment_method in ('instapay', 'cash')
    and exists (
      select 1 from public.packages
      where id = package_id and is_active and training_type <> 'trial'
    )
  );

-- ── Storage: payment-proofs (private, own-scoped by the first path folder) ──────
-- Mirrors coach-photos (image MIME + 5 MiB), but PRIVATE and PER-PLAYER: a player
-- uploads/reads only their own folder; the admin reads all (to review the proof). No
-- existing repo policy scopes by path, so this builds the (storage.foldername(name))[1]
-- = current_player_id() convention.
--
-- Path convention: '<player_id>/<filename>' (the first folder IS the player id — that's
-- what the policies pin). The request row is created AFTER upload (request_credits takes
-- the key), so the key can't embed request_id; a client uses a stable name (or upserts),
-- so a re-upload overwrites. An ABANDONED upload (uploaded, request never submitted) is
-- harmless — only the player + admin can read it, nothing references it — and the player
-- can delete their own; ops can sweep orphans later. Optional: a cash request may have none.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "payment proof insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_player_id())
  );

create policy "payment proof read own or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = (select public.current_player_id())
      or (select public.is_admin())
    )
  );

create policy "payment proof update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select public.current_player_id()))
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select public.current_player_id()));

create policy "payment proof delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select public.current_player_id()));

-- ── the ONE mint rule, now with an optional quantity override ────────────────
-- Approval sometimes grants a quantity that differs from the package's session_count (a
-- payment that didn't match). Rather than fork the mint, PARAMETERISE it: drop the 1-arg
-- and recreate with an optional p_quantity that defaults to session_count. Existing callers
-- (settle_purchase, record_cash_purchase) pass one arg and resolve to this — behaviour
-- unchanged. Still source='purchase' + purchase_id set = real revenue, one rule.
drop function tpa.mint_credits_for_purchase(text);
create function tpa.mint_credits_for_purchase(p_purchase_id text, p_quantity int default null)
  returns text
  language plpgsql
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
  v_pu       public.purchases;
  v_pkg      public.packages;
  v_qty      int;
begin
  select * into v_pu  from public.purchases where id = p_purchase_id;
  select * into v_pkg from public.packages  where id = v_pu.package_id;
  v_qty := coalesce(p_quantity, v_pkg.session_count);  -- override or the package default
  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
  values
    (v_batch_id, v_pu.player_id, 'purchase', p_purchase_id, v_pkg.training_type,
     v_qty, v_qty, now() + tpa.credit_expiry(), now(), null);
  return v_batch_id;
end;
$$;

-- ── request_credits — player-initiated claim ────────────────────────────────
-- Resolves the caller via current_player_id() (never an argument). Mints NOTHING. Rejects a
-- second pending, an inactive/trial package (the S5.1 "can't buy what you can't see" lesson,
-- checked here in-body since a definer bypasses RLS), and a proof path outside the caller's
-- own folder. Returns {ok, reason} as data.
create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player text := public.current_player_id();
  v_pkg    public.packages;
  v_id     text := 'cr_' || gen_random_uuid();
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_payment_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method');
  end if;
  -- One pending at a time (also the partial unique index; this is the clean reason).
  if exists (select 1 from public.credit_requests where player_id = v_player and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then                     return jsonb_build_object('ok', false, 'reason', 'package_missing');    end if;
  if v_pkg.training_type = 'trial' then return jsonb_build_object('ok', false, 'reason', 'trial_not_sellable'); end if;
  if not v_pkg.is_active then           return jsonb_build_object('ok', false, 'reason', 'package_inactive');   end if;
  -- A proof, if given, must be in the caller's OWN folder (defence in depth — Storage RLS
  -- already blocks uploading elsewhere, but the key is a free-text arg here).
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof_path');
  end if;

  begin
    insert into public.credit_requests (id, player_id, package_id, payment_method, proof_path, status, created_at)
      values (v_id, v_player, p_package_id, p_payment_method, p_proof_path, 'pending', now());
  exception
    when unique_violation then
      -- A concurrent submit raced the one-pending index → the other won.
      return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

-- ── approve_credit_request — admin, the money mutation ──────────────────────
-- One atomic transaction: mark approved, create a succeeded purchase (real revenue, the
-- request's method, no gateway refs), mint through the shared rule. granted_quantity/amount
-- are optional overrides (the "2,600 landed against a 2,800 8-pack" case), else the package
-- defaults. Idempotent: the FOR UPDATE lock serialises, and an already-approved request
-- mints nothing (the settle_purchase pattern). Notifies the player.
create or replace function public.approve_credit_request(p_request_id text, p_granted_quantity int default null, p_amount int default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_admin       text;
  v_req         public.credit_requests;
  v_pkg         public.packages;
  v_qty         int;
  v_amount      int;
  v_purchase_id text := 'pu_' || gen_random_uuid();
  v_batch_id    text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  -- Lock the request; the row lock serialises concurrent approvals.
  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_missing'); end if;

  -- Idempotent: a second approve of an already-approved request mints nothing.
  if v_req.status <> 'pending' then
    if v_req.status = 'approved' then
      return jsonb_build_object('ok', true, 'already_resolved', true, 'purchase_id', v_req.purchase_id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');  -- already rejected
  end if;

  select * into v_pkg from public.packages where id = v_req.package_id;
  -- Defaults from the package; overrides for a mismatched payment. Guard both.
  v_qty    := coalesce(p_granted_quantity, v_pkg.session_count);
  v_amount := coalesce(p_amount, v_pkg.price);
  if v_qty < 1 or v_qty > 1000 then return jsonb_build_object('ok', false, 'reason', 'invalid_quantity'); end if;
  if v_amount < 1 then              return jsonb_build_object('ok', false, 'reason', 'invalid_amount');   end if;

  -- Real revenue: a succeeded purchase (money-in) with the request's method + NO gateway
  -- refs, then mint through the ONE shared rule (source='purchase', purchase_id set).
  insert into public.purchases
    (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
  values
    (v_purchase_id, v_req.player_id, v_req.package_id, 'succeeded', v_amount, now(), v_req.payment_method, null, null);
  v_batch_id := tpa.mint_credits_for_purchase(v_purchase_id, v_qty);

  update public.credit_requests
     set status = 'approved', resolved_at = now(), resolved_by = v_admin, purchase_id = v_purchase_id
   where id = p_request_id;

  perform tpa.notify(
    v_req.player_id, 'credits_granted', 'Credits added',
    'You received ' || v_qty || ' ' || initcap(v_pkg.training_type) || ' credit'
      || case when v_qty = 1 then '' else 's' end || '.',
    null, null);

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ── reject_credit_request — admin, mints nothing ────────────────────────────
-- Marks rejected with a REQUIRED reason (the player must be told why), notifies, mints
-- nothing. Idempotent: an already-rejected request returns ok without re-notifying twice.
create or replace function public.reject_credit_request(p_request_id text, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_admin text;
  v_req   public.credit_requests;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_missing'); end if;

  if v_req.status <> 'pending' then
    if v_req.status = 'rejected' then
      return jsonb_build_object('ok', true, 'already_resolved', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');  -- already approved
  end if;

  update public.credit_requests
     set status = 'rejected', resolved_at = now(), resolved_by = v_admin, reject_reason = btrim(p_reason)
   where id = p_request_id;

  perform tpa.notify(
    v_req.player_id, 'credit_request_rejected', 'Credit request declined',
    'Your credit request was declined: ' || btrim(p_reason),
    null, null);

  return jsonb_build_object('ok', true, 'rejected', true);
end;
$$;

-- ── grants: the is_admin() body gate is the authorisation (S7b convention) ──────
revoke all on function public.request_credits(text, text, text) from public, anon;
grant execute on function public.request_credits(text, text, text) to authenticated;
revoke all on function public.approve_credit_request(text, int, int) from public, anon;
grant execute on function public.approve_credit_request(text, int, int) to authenticated;
revoke all on function public.reject_credit_request(text, text) from public, anon;
grant execute on function public.reject_credit_request(text, text) to authenticated;
