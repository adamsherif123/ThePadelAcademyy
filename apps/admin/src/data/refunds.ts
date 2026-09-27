import type { IsoInstant, Purchase, PurchaseId } from '@tpa/types';

import { markPurchaseRefundedRpc, type MarkRefundedReason, type MarkRefundedResult, type RefundRow } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Record that an owner has actually refunded a captured-but-undeliverable
 * payment in Paymob (068).
 *
 * This does NOT move money — Paymob does, by hand. It records that it happened,
 * so the queue empties and the note survives. That is why the note is required:
 * without the Paymob refund reference the row is an assertion nobody can check.
 */
export function markPurchaseRefunded(
  purchaseId: PurchaseId,
  note: string,
): Promise<MarkRefundedResult | { ok: false; reason: 'network' }> {
  return runRpc(() => markPurchaseRefundedRpc(purchaseId, note), TOUCHED.refunds);
}

/** Exhaustive by construction — a new server reason breaks the build, not the UI. */
export const REFUND_ERROR: Record<MarkRefundedReason | 'network', string> = {
  not_admin: "You don't have permission to record refunds.",
  reason_required: 'Add the Paymob refund reference (or a short note) so this can be checked later.',
  purchase_missing: 'That purchase no longer exists.',
  not_refund_required: 'That purchase doesn’t need a refund.',
  already_refunded: 'Someone already recorded a refund for this one.',
  network: 'Something went wrong. Please try again.',
};

/**
 * Is this purchase money the academy is holding and owes back?
 *
 * Deliberately keyed on the two timestamps and NOT on `status`. The row is
 * `status: 'failed'` whether or not it has been refunded, because 'failed' is
 * the only vocabulary the un-updatable 1.2/1.3 builds have (068) — so status
 * cannot tell these apart and must never be used to try.
 */
export function isRefundOutstanding(p: Purchase): boolean {
  return p.refundRequiredAt !== null && p.refundedAt === null;
}

export function isRefunded(p: Purchase): boolean {
  return p.refundRequiredAt !== null && p.refundedAt !== null;
}

/** Total still owed back, for the section header. */
export function outstandingTotal(rows: readonly RefundRow[]): number {
  return rows.filter((r) => isRefundOutstanding(r.purchase)).reduce((s, r) => s + r.purchase.amount, 0);
}

/**
 * How long a refund has been owed, in whole days — the only urgency signal the
 * queue needs. `now` is injected so this is testable and so every row on one
 * render measures from the same instant.
 */
export function daysOutstanding(p: Purchase, now: IsoInstant): number {
  if (p.refundRequiredAt === null) return 0;
  const ms = new Date(now).getTime() - new Date(p.refundRequiredAt).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
