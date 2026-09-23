import { deleteCreditBatchRpc, type DeleteCreditBatchResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Delete a credit batch and the purchase / credit request behind it — the undo
 * for a payment recorded against the wrong player, or a request approved twice.
 *
 * A SECURITY DEFINER RPC for the same reason grant_credits is one: there is no
 * admin DELETE policy on any money table, and there should not be. The RPC
 * refuses any batch with a booking against it rather than cascading, so this can
 * never quietly rewrite the attendance history coach hours are paid from.
 */
export function deleteCreditBatch(
  batchId: string,
): Promise<DeleteCreditBatchResult | { ok: false; reason: 'network' }> {
  return runRpc(() => deleteCreditBatchRpc(batchId), TOUCHED.creditBatchDelete);
}
