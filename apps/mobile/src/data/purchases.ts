import { ID_PREFIXES, buildPurchaseCredits, newId } from '@tpa/core';
import type { CreditBatch, IsoInstant, Package, PlayerId, Purchase, PurchaseId } from '@tpa/types';

import { commitPurchase, getPurchases } from './store';
import { packageById } from './catalog';

/** The current player's purchases, newest first. */
export function playerPurchases(playerId: PlayerId): Purchase[] {
  return getPurchases()
    .filter((p) => p.playerId === playerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Resolve the package a purchase was for (for history rows). */
export function packageForPurchase(purchase: Purchase): Package | undefined {
  return packageById(purchase.packageId);
}

export interface PurchaseResult {
  purchase: Purchase;
  batch: CreditBatch;
}

/**
 * THE PAYMENT SEAM. Everything payment-related is behind this one function.
 *
 * MOCK (S3b): synthesize a succeeded Purchase, grant its credits via
 * @tpa/core's buildPurchaseCredits, and commit both to the store.
 *
 * S6 replaces THIS BODY with the real flow — create a PENDING purchase, open the
 * Paymob iframe, and let the verified webhook flip it to succeeded and call
 * buildPurchaseCredits server-side. The screens call `payForPackage` and route to
 * purchase-success regardless; nothing above this function changes.
 */
export function payForPackage(
  playerId: PlayerId,
  pkg: Package,
  now: IsoInstant,
): PurchaseResult {
  const purchaseId = newId(ID_PREFIXES.purchase) as PurchaseId;
  const purchase: Purchase = {
    id: purchaseId,
    playerId,
    packageId: pkg.id,
    status: 'succeeded',
    amount: pkg.price,
    createdAt: now,
    paymentMethod: 'paymob', // the in-app flow is the card gateway (S6)
    gatewayOrderId: null,
    gatewayTransactionId: null,
  };
  const batch = buildPurchaseCredits(playerId, purchaseId, pkg, now);
  commitPurchase(purchase, batch);
  return { purchase, batch };
}
