-- ============================================================================
-- S6.1 — fail_purchase: record a DECLINED payment.
--
-- S6 shipped settle_purchase (pending → succeeded, mints). But a declined callback
-- had no home: the webhook only acted on success=true, so a decline left the
-- purchase 'pending' forever and the return screen polled to a misleading
-- "still confirming". purchases.status has carried 'failed' in its CHECK since S5
-- (20260716000001_tables.sql) and it has never been written — this is the writer.
--
-- fail_purchase is settle_purchase's mirror image, and deliberately a SIBLING, not
-- an extension: settle_purchase's success path and its idempotency guard are proven
-- (rpc_admin_test) and MUST NOT change. Same guarantees:
--   * service_role ONLY (a player who could fail their own purchase gains nothing,
--     but the gateway is service_role's alone — keep the surface identical);
--   * idempotent — a redelivered decline is a no-op (already_failed);
--   * it NEVER mints credits (it only writes a terminal status);
--   * the guarded UPDATE ... WHERE status='pending' is the whole safety story.
--
-- TERMINAL-STATE RULE: 'pending' is the only non-terminal status. 'succeeded' and
-- 'failed' are both terminal and neither ever transitions to the other:
--   * settle_purchase advances only pending → succeeded (a 'failed' purchase yields
--     not_pending, mints nothing — unchanged);
--   * fail_purchase advances only pending → failed (a 'succeeded' purchase yields
--     already_succeeded, stays succeeded, never loses its credits).
-- A captured payment is never retroactively failed; a declined one is never quietly
-- settled.
-- ============================================================================

create or replace function public.fail_purchase(p_purchase_id text, p_gateway_transaction_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;

  -- Guarded fail: only a PENDING purchase advances (and only once). We record the
  -- gateway transaction id even on a decline — the ledger tells the whole truth.
  update public.purchases
    set status = 'failed', gateway_transaction_id = p_gateway_transaction_id
    where id = p_purchase_id and status = 'pending';
  if not found then
    -- Already terminal. A redelivered decline is a no-op; a succeeded purchase is
    -- NEVER flipped to failed (terminal-state rule) — and no credits are touched.
    if v_status = 'failed' then return jsonb_build_object('ok', true, 'already_failed', true); end if;
    return jsonb_build_object('ok', false, 'reason', 'already_succeeded');
  end if;

  -- No mint. Ever. A decline produces no credits.
  return jsonb_build_object('ok', true, 'already_failed', false);
end;
$$;

-- Same privilege model as settle_purchase: the gateway (service_role) alone.
revoke all on function public.fail_purchase(text, text) from public, anon, authenticated;
grant execute on function public.fail_purchase(text, text) to service_role;
