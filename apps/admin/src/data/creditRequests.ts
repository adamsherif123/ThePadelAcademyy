import {
  approveCreditRequestRpc,
  rejectCreditRequestRpc,
  type ApproveRequestResult,
  type RejectRequestResult,
} from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Approve a credit request (A3/A4): the atomic approve_credit_request RPC records a
 * succeeded purchase (real revenue) and mints the credits. `grantedQuantity` / `amount` are
 * optional overrides (null → the package's defaults) for a payment that didn't match. Money,
 * so it goes through the SECURITY DEFINER RPC — the admin app has no direct write on
 * purchases/credit_batches. Idempotent server-side (approving twice mints once).
 */
export function approveCreditRequest(
  requestId: string,
  grantedQuantity: number | null,
  amount: number | null,
): Promise<ApproveRequestResult | { ok: false; reason: 'network' }> {
  return runRpc(() => approveCreditRequestRpc(requestId, grantedQuantity, amount), TOUCHED.creditRequests);
}

/** Reject a credit request with a required reason (shown to the player). Mints nothing. */
export function rejectCreditRequest(
  requestId: string,
  reason: string,
): Promise<RejectRequestResult | { ok: false; reason: 'network' }> {
  return runRpc(() => rejectCreditRequestRpc(requestId, reason), TOUCHED.creditRequests);
}
