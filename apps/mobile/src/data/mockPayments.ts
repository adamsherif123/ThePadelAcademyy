import { ID_PREFIXES, buildPurchaseCredits, newId } from '@tpa/core';
import type { CreditBatch, IsoInstant, Package, PlayerId, Purchase, PurchaseId } from '@tpa/types';

/**
 * THE PAYMENT SEAM — still mocked (S6 owns Paymob). Everything payment-related is
 * behind `payForPackage`, and its effects live in this one client-only overlay.
 *
 * Why an overlay and not the store: the app's credits now come from Supabase, but a
 * client CANNOT mint credit batches (RLS forbids it — only the gateway webhook /
 * cash settlement does, server-side). So a mocked purchase can't write real credits.
 * Instead it records the synthesized purchase + grant here, and the query layer
 * MERGES this overlay into the wallet + history reads so the buy → wallet → book
 * demo keeps working unchanged.
 *
 * The one honest seam here: an overlay ("mock-purchased") credit is client-only, so
 * booking a REAL slot against it goes to book_slot, which returns `no_usable_credit`
 * because the server never saw that batch — a genuine preview/RPC disagreement,
 * inherent to mocking purchases while enforcing bookings for real. Trial credits
 * (minted by complete_signup) are server-real and fully consistent.
 *
 * S6 deletes this file: the gateway mints the batch server-side and the wallet query
 * picks it up with no overlay. Screens call `payForPackage` and route to
 * purchase-success either way — nothing above this function changes.
 */
interface Overlay {
  purchases: Purchase[];
  batches: CreditBatch[];
}

let overlay: Overlay = { purchases: [], batches: [] };

export function getMockOverlay(): Overlay {
  return overlay;
}

/** Cleared on sign-out so the next player starts clean. */
export function resetMockOverlay(): void {
  overlay = { purchases: [], batches: [] };
}

export interface PurchaseResult {
  purchase: Purchase;
  batch: CreditBatch;
}

export async function payForPackage(
  playerId: PlayerId,
  pkg: Package,
  now: IsoInstant,
): Promise<PurchaseResult> {
  // Simulate the gateway round-trip so the checkout spinner is real.
  await new Promise((resolve) => setTimeout(resolve, 600));

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
  overlay = {
    purchases: [purchase, ...overlay.purchases],
    batches: [batch, ...overlay.batches],
  };
  return { purchase, batch };
}
