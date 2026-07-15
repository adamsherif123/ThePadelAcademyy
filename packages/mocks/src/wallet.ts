import type {
  CreditBatch,
  CreditBatchId,
  PackageId,
  PlayerId,
  Purchase,
  PurchaseId,
} from '@tpa/types';

import { daysFromNow, egp } from './now';

/**
 * Purchases covering every PurchaseStatus. The four succeeded ones fund the
 * current player's wallet batches below; the pending/failed ones exercise those
 * UI states. `amount` mirrors the package price at purchase time.
 */
export const mockPurchases: Purchase[] = [
  { id: 'pu_omar_group8' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_group_8' as PackageId, status: 'succeeded', amount: egp(2800), createdAt: daysFromNow(-5), gatewayOrderId: 'pmob_ord_1001', gatewayTransactionId: 'pmob_txn_5001' },
  { id: 'pu_omar_group4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_group_4' as PackageId, status: 'succeeded', amount: egp(1600), createdAt: daysFromNow(-28), gatewayOrderId: 'pmob_ord_1002', gatewayTransactionId: 'pmob_txn_5002' },
  { id: 'pu_omar_duo4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_duo_4' as PackageId, status: 'succeeded', amount: egp(2200), createdAt: daysFromNow(-33), gatewayOrderId: 'pmob_ord_1003', gatewayTransactionId: 'pmob_txn_5003' },
  { id: 'pu_omar_indiv4' as PurchaseId, playerId: 'pl_omar' as PlayerId, packageId: 'pk_indiv_4' as PackageId, status: 'succeeded', amount: egp(3200), createdAt: daysFromNow(-10), gatewayOrderId: 'pmob_ord_1004', gatewayTransactionId: 'pmob_txn_5004' },

  // pending: client created it, webhook hasn't confirmed — no transaction yet.
  { id: 'pu_youssef_duo4' as PurchaseId, playerId: 'pl_youssef' as PlayerId, packageId: 'pk_duo_4' as PackageId, status: 'pending', amount: egp(2200), createdAt: daysFromNow(0), gatewayOrderId: 'pmob_ord_1005', gatewayTransactionId: null },
  // failed: gateway declined the transaction.
  { id: 'pu_tarek_indiv4' as PurchaseId, playerId: 'pl_tarek' as PlayerId, packageId: 'pk_indiv_4' as PackageId, status: 'failed', amount: egp(3200), createdAt: daysFromNow(-1), gatewayOrderId: 'pmob_ord_1006', gatewayTransactionId: 'pmob_txn_5006' },
];

/**
 * The current player's typed credit wallet. Deliberately includes one batch
 * expiring in 2 days and one already expired, so the expiry UI can be built and
 * tested. Expiries follow the 30-day rule (createdAt + 30d) except where the
 * relative anchor makes that explicit.
 */
export const mockCreditBatches: CreditBatch[] = [
  // Healthy group credits, plenty of runway.
  { id: 'cb_group_main' as CreditBatchId, playerId: 'pl_omar' as PlayerId, purchaseId: 'pu_omar_group8' as PurchaseId, trainingType: 'group', quantityTotal: 8, quantityRemaining: 5, createdAt: daysFromNow(-5), expiresAt: daysFromNow(25) },
  // Expiring in 2 days — drives the "expires in 2 days" warning.
  { id: 'cb_group_expiring' as CreditBatchId, playerId: 'pl_omar' as PlayerId, purchaseId: 'pu_omar_group4' as PurchaseId, trainingType: 'group', quantityTotal: 4, quantityRemaining: 2, createdAt: daysFromNow(-28), expiresAt: daysFromNow(2) },
  // Already expired — drives the "expired" state; not usable.
  { id: 'cb_duo_expired' as CreditBatchId, playerId: 'pl_omar' as PlayerId, purchaseId: 'pu_omar_duo4' as PurchaseId, trainingType: 'duo', quantityTotal: 4, quantityRemaining: 1, createdAt: daysFromNow(-33), expiresAt: daysFromNow(-3) },
  // Individual credits, full and fresh.
  { id: 'cb_indiv_main' as CreditBatchId, playerId: 'pl_omar' as PlayerId, purchaseId: 'pu_omar_indiv4' as PurchaseId, trainingType: 'individual', quantityTotal: 4, quantityRemaining: 4, createdAt: daysFromNow(-10), expiresAt: daysFromNow(20) },
];
