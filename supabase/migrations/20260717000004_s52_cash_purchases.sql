-- ============================================================================
-- S5.2 — cash purchases.
--
-- The academy takes cash at the desk. A cash sale is an ORDINARY Purchase —
-- status 'succeeded', no gateway refs — whose credits mint through the normal
-- source='purchase' path. It is real revenue: not a faked card sale, not a
-- comp. Mirrors Purchase.paymentMethod: 'paymob' | 'cash' arriving in
-- @tpa/types on main (S4f.1).
--
-- Recording a cash sale is money-in-one-transaction (insert a succeeded
-- purchase + mint a credit_batch), so it belongs to S7/S10's SECURITY DEFINER
-- RPC — exactly like admin_grant. This migration adds the SHAPE (column +
-- invariants) and tightens the client's insert policy; it deliberately adds NO
-- admin write path on purchases or credit_batches.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — purchases.payment_method (text + CHECK, matching the enum decision).
--
-- NOT NULL and NO DEFAULT. The "no defaults" rule was about PKs, but the same
-- honesty argument applies with more force here: this column records how real
-- money physically arrived. A silent default would let a mis-written insert
-- (one that simply forgot the field) claim a payment method it never verified —
-- a cash sale masquerading as a card sale, or vice versa, in the revenue books.
-- Better a loud 23502 not-null failure at insert time than a quietly wrong
-- financial record. Every mint path (S6 webhook, S7/S10 cash RPC) already knows
-- exactly how the money came in, so stating it explicitly costs nothing.
--
-- Safe as a NOT-NULL-without-default ADD COLUMN because purchases is empty at
-- migration time (no seed.sql ships credits/purchases).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.purchases
  add column payment_method text not null
  constraint purchases_payment_method_valid check (payment_method in ('paymob', 'cash'));

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — cash never touches Paymob, so a cash purchase has no gateway refs.
--
-- ASYMMETRIC by design: the constraint only bites cash. A 'paymob' purchase
-- legitimately carries NULL refs while it is still pending (the gateway handles
-- are assigned later, by S6), so we must NOT require paymob refs to be present.
-- We only forbid cash from ever having them.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.purchases
  add constraint purchases_cash_has_no_gateway_refs
  check (
    payment_method <> 'cash'
    or (gateway_order_id is null and gateway_transaction_id is null)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 3 — lock the client out of cash (defence in depth).
--
-- The existing status='pending' pin already blocks a client from creating a
-- succeeded cash sale. We ALSO pin payment_method='paymob' so the intent is
-- explicit and belt-and-suspenders: a player can only ever open their own
-- online (Paymob) checkout; they can never record a cash payment for
-- themselves. (Cf. test 23 — the amount pin proved load-bearing in a way nobody
-- predicted; be generous with explicit pins on the money surface.)
--
-- Recreated (not altered) because the payment_method column it references did
-- not exist when the original policy was created in S5.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy purchases_insert_own_pending on public.purchases;
create policy purchases_insert_own_pending on public.purchases
  for insert to authenticated
  with check (
    player_id = (select public.current_player_id())
    and status = 'pending'
    -- A player opens only their own Paymob checkout — never a cash sale.
    and payment_method = 'paymob'
    and gateway_order_id is null
    and gateway_transaction_id is null
    -- LOAD-BEARING — DO NOT "simplify" the amount subselect. It is RLS-filtered:
    -- an INACTIVE package is invisible to the player, so the subselect yields
    -- NULL → amount = NULL → NULL → WITH CHECK fails. This is the only thing
    -- stopping a player from purchasing a hidden/inactive package (rls_test 23).
    and amount = (select price from public.packages where id = package_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 4 — the line holds. No admin insert policy on purchases; no write policy
-- on credit_batches. Recording a cash sale is money+credits in one atomic
-- transaction → S7/S10 SECURITY DEFINER RPC, same rule as admin_grant. An admin
-- insert policy here would let the admin app write a succeeded purchase without
-- (or out of sync with) the matching credit mint. rls_test proves an admin is
-- denied a direct purchase insert, alongside the existing bookings/batches cases.
-- ─────────────────────────────────────────────────────────────────────────────
