import type { IsoInstant, Piastres, PackageId, PlayerId, Purchase, PurchaseId } from '@tpa/types';

import { ID_PREFIXES, newId } from './ids';

/**
 * Build a settled CASH purchase — money already received at the desk. A cash sale
 * is an ordinary purchase whose only difference from a Paymob one is the channel,
 * so it lands `succeeded` immediately (no gateway round-trip) with NO gateway
 * handles. `amount` is captured here (a desk discount is honoured and made
 * permanent — later package repricing can't move it), so callers pass the agreed
 * amount, not necessarily the list price. Never hand-construct the row: this
 * builder is what keeps the "cash ⇒ succeeded, no gateway refs" promise the DB
 * enforces with a CHECK.
 */
export function buildCashPurchase(
  playerId: PlayerId,
  packageId: PackageId,
  amount: Piastres,
  now: IsoInstant,
): Purchase {
  return {
    id: newId(ID_PREFIXES.purchase) as PurchaseId,
    playerId,
    packageId,
    status: 'succeeded',
    amount,
    createdAt: now,
    paymentMethod: 'cash',
    gatewayOrderId: null,
    gatewayTransactionId: null,
  };
}

/**
 * Runtime mirror of the DB CHECK: a cash purchase never carries gateway
 * references (there is no gateway). Card purchases are unconstrained here.
 */
export function cashPurchaseHasNoGatewayRefs(purchase: Purchase): boolean {
  return (
    purchase.paymentMethod !== 'cash' ||
    (purchase.gatewayOrderId === null && purchase.gatewayTransactionId === null)
  );
}
