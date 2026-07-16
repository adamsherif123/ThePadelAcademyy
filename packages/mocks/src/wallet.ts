import { buildSignupGrant } from '@tpa/core';
import type {
  CreditBatch,
  CreditBatchId,
  PackageId,
  PlayerId,
  Purchase,
  PurchaseId,
} from '@tpa/types';

import { generatedBatches, generatedPurchases } from './generated';
import { MOCK_NOW, daysFromNow, egp } from './now';

/**
 * Purchases covering every PurchaseStatus. The four succeeded ones fund the
 * current player's wallet batches below; the pending/failed ones exercise those
 * UI states. `amount` mirrors the package price at purchase time.
 */
const handPurchases: Purchase[] = [
  { id: 'pu_omar_group8' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_group_8' as PackageId, status: 'succeeded', amount: egp(2800), createdAt: daysFromNow(-5), gatewayOrderId: 'pmob_ord_1001', gatewayTransactionId: 'pmob_txn_5001' },
  { id: 'pu_omar_group4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_group_4' as PackageId, status: 'succeeded', amount: egp(1600), createdAt: daysFromNow(-28), gatewayOrderId: 'pmob_ord_1002', gatewayTransactionId: 'pmob_txn_5002' },
  { id: 'pu_omar_duo4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_duo_4' as PackageId, status: 'succeeded', amount: egp(2200), createdAt: daysFromNow(-33), gatewayOrderId: 'pmob_ord_1003', gatewayTransactionId: 'pmob_txn_5003' },
  { id: 'pu_omar_indiv4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_indiv_4' as PackageId, status: 'succeeded', amount: egp(3200), createdAt: daysFromNow(-10), gatewayOrderId: 'pmob_ord_1004', gatewayTransactionId: 'pmob_txn_5004' },

  // pending: client created it, webhook hasn't confirmed — no transaction yet.
  // (Belongs to the current player so purchase history shows every status.)
  { id: 'pu_omar_duo4_pending' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_duo_4' as PackageId, status: 'pending', amount: egp(2200), createdAt: daysFromNow(0), gatewayOrderId: 'pmob_ord_1005', gatewayTransactionId: null },
  // failed: gateway declined the transaction.
  { id: 'pu_omar_indiv4_failed' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_indiv_4' as PackageId, status: 'failed', amount: egp(3200), createdAt: daysFromNow(-1), gatewayOrderId: 'pmob_ord_1006', gatewayTransactionId: 'pmob_txn_5006' },
];

/** Hand-tuned core purchases + academy-scale generated history (dashboard revenue). */
export const mockPurchases: Purchase[] = [...handPurchases, ...generatedPurchases];

/**
 * Signup-grant trial batches, built through @tpa/core's `buildSignupGrant` so the
 * fixtures exercise the real grant code path (source, null purchaseId, quantity,
 * 30-day expiry). Only the deterministic id and the "how much is left / when"
 * knobs are overridden, to stage the three states the trial UI must handle. The
 * builder is called with the grant's own `now` (= account creation time) so its
 * expiry math produces the right expiresAt for each case.
 */
const signupGrants: CreditBatch[] = [
  // Fresh account: 2 unused trial credits, ~30 days of runway.
  { ...buildSignupGrant('pl_omar' as PlayerId, MOCK_NOW), id: 'cb_grant_omar' as CreditBatchId },
  // Used 1 of 2.
  {
    ...buildSignupGrant('pl_youssef' as PlayerId, daysFromNow(-5)),
    id: 'cb_grant_youssef' as CreditBatchId,
    quantityRemaining: 1,
  },
  // Granted 31 days ago, expired unused (created + 30d < now).
  { ...buildSignupGrant('pl_nour' as PlayerId, daysFromNow(-31)), id: 'cb_grant_nour' as CreditBatchId },
];

/**
 * The typed credit wallet. Purchased batches (`source: 'purchase'`, non-null
 * purchaseId) plus the signup-grant trial batches above. Deliberately includes a
 * batch expiring in 2 days and one already expired so the expiry UI can be built
 * and tested. Purchased expiries follow the 30-day rule except where the relative
 * anchor makes that explicit.
 */
const handBatches: CreditBatch[] = [
  // Healthy group credits, plenty of runway.
  { id: 'cb_group_main' as CreditBatchId, playerId: 'pl_omar' as PlayerId, source: 'purchase', purchaseId: 'pu_omar_group8' as PurchaseId, trainingType: 'group', quantityTotal: 8, quantityRemaining: 5, createdAt: daysFromNow(-5), expiresAt: daysFromNow(25) },
  // Expiring in 2 days — drives the "expires in 2 days" warning.
  { id: 'cb_group_expiring' as CreditBatchId, playerId: 'pl_omar' as PlayerId, source: 'purchase', purchaseId: 'pu_omar_group4' as PurchaseId, trainingType: 'group', quantityTotal: 4, quantityRemaining: 2, createdAt: daysFromNow(-28), expiresAt: daysFromNow(2) },
  // Already expired — drives the "expired" state; not usable.
  { id: 'cb_duo_expired' as CreditBatchId, playerId: 'pl_omar' as PlayerId, source: 'purchase', purchaseId: 'pu_omar_duo4' as PurchaseId, trainingType: 'duo', quantityTotal: 4, quantityRemaining: 1, createdAt: daysFromNow(-33), expiresAt: daysFromNow(-3) },
  // Individual credits, full and fresh.
  { id: 'cb_indiv_main' as CreditBatchId, playerId: 'pl_omar' as PlayerId, source: 'purchase', purchaseId: 'pu_omar_indiv4' as PurchaseId, trainingType: 'individual', quantityTotal: 4, quantityRemaining: 4, createdAt: daysFromNow(-10), expiresAt: daysFromNow(20) },

  ...signupGrants,
];

/**
 * Hand-tuned core batches (incl. the signup grants) + the purchase-backed batches
 * the generated purchases grant. Generated batches are all `source: 'purchase'`,
 * so the grant/purchase invariants the fixture tests assert stay intact.
 */
export const mockCreditBatches: CreditBatch[] = [...handBatches, ...generatedBatches];
