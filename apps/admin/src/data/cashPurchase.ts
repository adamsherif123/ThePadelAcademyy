import type { PackageId, Piastres, PlayerId } from '@tpa/types';

import { recordCashPurchaseRpc, type CashResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Record a settled CASH purchase and mint its credits atomically via the
 * record_cash_purchase RPC (one transaction: succeeded purchase + purchase-backed
 * batch). `amount` is the captured price (discounts are real). The RPC rejects a
 * trial or inactive package — never looser than the player-facing path.
 */
export function recordCashPurchase(
  playerId: PlayerId,
  packageId: PackageId,
  amount: Piastres,
): Promise<CashResult | { ok: false; reason: 'network' }> {
  return runRpc(() => recordCashPurchaseRpc(playerId, packageId, amount), TOUCHED.money);
}
