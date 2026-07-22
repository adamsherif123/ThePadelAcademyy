-- ============================================================================
-- A3 (rail, part 1) — payment_method gains 'instapay'; a rejection notification type.
--
-- Paymob is MOTHBALLED (merchant verification isn't done), so credits are bought
-- out-of-band: an InstaPay transfer or cash at the desk, then reported for crediting.
-- 'instapay' joins 'paymob' | 'cash'. Paymob's column/constraints/policies are NOT
-- touched — only the valid-set widens and the S5.2 "offline sale carries no gateway
-- refs" reasoning extends to instapay (parallel to cash; cash's own constraint is left
-- exactly as it is).
-- ============================================================================

-- ── purchases.payment_method: add 'instapay' to the valid set ───────────────
-- A text+CHECK can only gain a value by drop+recreate. This widens the set; paymob and
-- cash keep the identical membership they had.
alter table public.purchases drop constraint purchases_payment_method_valid;
alter table public.purchases
  add constraint purchases_payment_method_valid
  check (payment_method in ('paymob', 'cash', 'instapay'));

-- ── instapay, like cash, never touches Paymob → no gateway refs ─────────────
-- A SEPARATE constraint parallel to purchases_cash_has_no_gateway_refs (which is left
-- untouched). Asymmetric by the same S5.2 logic: it bites only instapay; a paymob purchase
-- may still carry NULL refs while pending and real refs once settled.
alter table public.purchases
  add constraint purchases_instapay_has_no_gateway_refs
  check (
    payment_method <> 'instapay'
    or (gateway_order_id is null and gateway_transaction_id is null)
  );

-- ── notifications: a type for a rejected credit request ─────────────────────
-- Approval reuses the existing 'credits_granted' type (credits really were added). A
-- rejection needs its own type so the client can phrase it. Extend the CHECK (drop+recreate).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected'));
