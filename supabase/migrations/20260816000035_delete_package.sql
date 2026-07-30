-- ============================================================================
-- Admin: delete a package — hard-delete if genuinely unused, retire if it has
-- any purchase/request history. Mirrors delete_template's deleted_at pattern.
--
-- ── schema ──
-- `deleted_at timestamptz` on packages, nullable, null = live (same shape as
-- availability_templates.deleted_at / players.deleted_at). Additive: every
-- existing row gets deleted_at = null, i.e. stays exactly as it reads today.
-- Retiring force-sets is_active = false in the same statement — same reason
-- as delete_template: no code path (the catalog, the money RPCs) should ever
-- be able to see is_active = true on a deleted row.
--
-- ── hard-delete vs. retire, and why it's NOT a plain "count purchases" ──
-- packages is referenced by TWO tables, not one: purchases.package_id AND
-- credit_requests.package_id (A3) — both `not null references public.packages
-- (id)` with no ON DELETE clause (default RESTRICT). A package can rack up a
-- pending/rejected credit_request and still have zero rows in purchases (an
-- InstaPay request that hasn't been approved yet, or was rejected) — so a
-- naive "count(*) from purchases = 0 → safe to hard-delete" check is wrong:
-- it would attempt a DELETE that the credit_requests FK then rejects, on a
-- package the check itself called "unused".
--
-- So: attempt the DELETE and let Postgres be the single source of truth on
-- "is this package referenced anywhere" — catch the foreign_key_violation
-- and retire instead. This is correct against BOTH referencing tables today
-- and against any future one, with no enumeration to keep in sync.
--
-- ── race safety ──
-- The package row is locked FOR UPDATE before either branch runs. That lock
-- is not just for the idempotency re-check (mirrors delete_template) — a
-- Postgres FK check on INSERT into purchases/credit_requests acquires a FOR
-- KEY SHARE lock on the referenced packages row, and FOR KEY SHARE conflicts
-- with FOR UPDATE. So holding FOR UPDATE on this row for the duration of the
-- function blocks any concurrent purchase/credit-request insert that
-- references THIS package until we commit — there is no window between
-- "decide to hard-delete" and "actually delete" for a purchase to land and
-- get orphaned. The catch-fallback then handles the decision itself
-- correctly (see above); the lock makes that decision race-safe. Belt and
-- braces: lock-then-act's row lock is what closes the race, catch-fallback
-- is what makes the "is it used" check exhaustive rather than table-specific.
--
-- ── the trial package ──
-- Blocked outright, never auto-retired: `training_type = 'trial'` returns
-- `trial_package_protected`, whether or not it's ever been purchased. The
-- once-per-player trial flow (A5) reads the trial package by training_type
-- via request_credits/record_cash_purchase — losing the row (or even
-- retiring it, which would make it unbuyable) breaks the trial funnel for
-- every future player, not just historical ones. An admin who wants to stop
-- selling the trial should hit the existing Sellable/Hidden toggle, which
-- already does exactly that without touching the row identity. Deleting a
-- package the checkout flow depends on structurally isn't the same operation
-- as deleting a discontinued bundle, so it gets its own reason rather than
-- silently falling into "retire".
-- ============================================================================

alter table public.packages add column deleted_at timestamptz;

create or replace function public.delete_package(p_package_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_pkg public.packages;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_pkg from public.packages where id = p_package_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'package_missing'); end if;

  -- Idempotent: a double-click (or a retry after a dropped response) sees
  -- the package already gone/retired and no-ops cleanly.
  if v_pkg.deleted_at is not null then
    return jsonb_build_object('ok', true, 'action', 'already_deleted');
  end if;

  if v_pkg.training_type = 'trial' then
    return jsonb_build_object('ok', false, 'reason', 'trial_package_protected');
  end if;

  begin
    delete from public.packages where id = p_package_id;
    return jsonb_build_object('ok', true, 'action', 'deleted');
  exception when foreign_key_violation then
    update public.packages set deleted_at = now(), is_active = false where id = p_package_id;
    return jsonb_build_object('ok', true, 'action', 'retired');
  end;
end;
$$;

revoke all on function public.delete_package(text) from public;
grant execute on function public.delete_package(text) to authenticated;

-- ============================================================================
-- The other side of the race: request_credits and record_cash_purchase both
-- read a package with a plain SELECT (no FOR UPDATE — never needed one before,
-- since nothing could ever remove a package out from under them) and only
-- THEN insert an FK-referencing row (credit_requests / purchases). Before
-- delete_package existed this was fine — a package could be hidden
-- (is_active=false) but never disappear. Now it can: if delete_package's
-- hard-delete commits in the gap between that read and this insert, the
-- insert's own FK check (which blocks on delete_package's FOR UPDATE lock,
-- then re-checks once unblocked) hits a row that is really gone and raises
-- foreign_key_violation — previously impossible, now a real ordering these
-- two RPCs must return cleanly on, not crash on. Both already have a
-- begin/exception block for their unique_violation cases; this just adds the
-- one new exception Postgres can now raise here, mapped to the same
-- package_missing reason each RPC already returns for "no such package".
-- Nothing else in either function changes.
-- ============================================================================

create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text := public.current_player_id();
  v_pkg        public.packages;
  v_id         text := 'cr_' || gen_random_uuid();
  v_is_trial   boolean;
  v_constraint text;
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_payment_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method');
  end if;
  if exists (select 1 from public.credit_requests where player_id = v_player and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;

  v_is_trial := (v_pkg.training_type = 'trial');
  -- A trial is once-per-player, ever (A5). Reject a second cleanly, never as a crash.
  if v_is_trial and tpa.trial_used(v_player) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof_path');
  end if;

  begin
    insert into public.credit_requests (id, player_id, package_id, payment_method, proof_path, status, created_at, is_trial)
      values (v_id, v_player, p_package_id, p_payment_method, p_proof_path, 'pending', now(), v_is_trial);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_requests_one_trial_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_pending');
    when foreign_key_violation then
      -- The package was deleted (delete_package's hard-delete) between our read
      -- above and this insert — same clean reason as "no such package".
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

create or replace function public.record_cash_purchase(p_player_id text, p_package_id text, p_amount int)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_pkg         public.packages;
  v_purchase_id text := 'pu_' || gen_random_uuid();
  v_batch_id    text;
  v_constraint  text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;
  if p_amount < 1 then         return jsonb_build_object('ok', false, 'reason', 'amount_below_one'); end if;

  -- Once-per-player trial (A5): reject a second trial (a purchased batch or a live request).
  if v_pkg.training_type = 'trial' and tpa.trial_used(p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  begin
    insert into public.purchases
      (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
    values
      (v_purchase_id, p_player_id, p_package_id, 'succeeded', p_amount, now(), 'cash', null, null);
    v_batch_id := tpa.mint_credits_for_purchase(v_purchase_id);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_batches_one_trial_purchase_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      raise;
    when foreign_key_violation then
      -- The package was deleted (delete_package's hard-delete) between our read
      -- above and this insert — same clean reason as "no such package".
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$$;
