import { buildCashPurchase, buildPurchaseCredits } from '@tpa/core';
import type { CreditBatch, IsoInstant, PackageId, Piastres, PlayerId, Purchase } from '@tpa/types';

import { commitCashPurchase, getPackages, getPlayers } from './store';

/**
 * Record a cash sale taken at the desk — modelled as what it IS: a purchase. Money
 * changed hands, so this is NOT a comp: the purchase counts toward revenue, and its
 * credits are ordinary purchase-backed credits that count toward liability. The
 * only difference from a Paymob sale is the channel.
 *
 * The purchase is built by @tpa/core's buildCashPurchase (settled, no gateway refs)
 * and the credits by buildPurchaseCredits (source 'purchase', real purchaseId,
 * 30-day expiry) — never hand-constructed, so the DB CHECKs are honoured. `amount`
 * is captured, so a desk discount is permanent and S4e's repricing-immune liability
 * values these credits at what the player actually paid.
 *
 * S10 replaces this body with a SECURITY DEFINER RPC (minting money must be atomic
 * + audited; the client can only ever insert its own PENDING purchases and cannot
 * write credit_batches at all).
 */
export type RecordCashResult =
  | { ok: true; purchase: Purchase; batch: CreditBatch }
  | { ok: false; reason: 'player_missing' | 'package_missing' | 'amount_below_one' };

export function recordCashPurchase(
  playerId: PlayerId,
  packageId: PackageId,
  amount: Piastres,
  now: IsoInstant,
): RecordCashResult {
  if (!getPlayers().some((p) => p.id === playerId)) return { ok: false, reason: 'player_missing' };
  const pkg = getPackages().find((p) => p.id === packageId);
  if (!pkg) return { ok: false, reason: 'package_missing' };
  if (amount < 1) return { ok: false, reason: 'amount_below_one' };

  const purchase = buildCashPurchase(playerId, packageId, amount, now);
  const batch = buildPurchaseCredits(playerId, purchase.id, pkg, now);
  commitCashPurchase(purchase, batch);
  return { ok: true, purchase, batch };
}
