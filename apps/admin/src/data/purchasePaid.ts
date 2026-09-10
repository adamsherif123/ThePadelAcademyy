import { setPurchasePaidRpc, type SetPurchasePaidResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Mark a purchase as collected (paid) or not. Goes through the set_purchase_paid
 * SECURITY DEFINER RPC — the admin app has no direct write on purchases. On success
 * it invalidates TOUCHED.purchasePaid, which covers BOTH places a purchase's paid
 * state is read from (the monolith and the Credit Requests page's embed).
 */
export function setPurchasePaid(
  purchaseId: string,
  paid: boolean,
): Promise<SetPurchasePaidResult | { ok: false; reason: 'network' }> {
  return runRpc(() => setPurchasePaidRpc(purchaseId, paid), TOUCHED.purchasePaid);
}
