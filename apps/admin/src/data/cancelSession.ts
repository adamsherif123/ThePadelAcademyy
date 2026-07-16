import type { Booking, BookingId, CreditBatch, IsoInstant, SessionSlot, SlotId } from '@tpa/types';

import { commitSessionCancellation, getBatches, getBookings, getSlots } from './store';

/**
 * THE ACADEMY-CANCEL SEAM — the money-equivalent mutation for when the academy
 * (not the player) cancels a session. Mirrors the mobile app's booking seams; S10
 * replaces THIS BODY with one atomic DB RPC (cancel slot + refund N players under
 * a unique/status guard), leaving the screen unchanged.
 *
 * The rules (client-confirmed), and how they differ from a player cancelling:
 *  - EVERY booked player is refunded, regardless of the 3-hour window. The forfeit
 *    rule (isCancellableWithoutForfeit) is for player-initiated cancels only — a
 *    blameless player isn't punished for a rained-out session. It is never called
 *    here.
 *  - Each refund goes to the booking's ORIGINAL creditBatchId with its ORIGINAL
 *    expiry — a refund never buys time, even at the academy's fault. If the batch
 *    has already expired, increment it anyway (the ledger tells the truth) and let
 *    isBatchUsable reject it downstream (same rule S3e implemented).
 *  - The slot → cancelled; every booking on it → cancelled with cancelledAt.
 *  - IDEMPOTENT: only status==='booked' bookings are refunded, and a cancelled slot
 *    is rejected — re-cancelling can't double-refund N players.
 */
export type CancelSessionResult =
  | { ok: true; refundedCount: number; affectedBookingIds: BookingId[] }
  | { ok: false; reason: 'slot_missing' | 'already_cancelled' };

export function cancelSession(slotId: SlotId, now: IsoInstant): CancelSessionResult {
  const slot = getSlots().find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };
  // Idempotency guard #1: an already-cancelled slot never refunds again.
  if (slot.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };

  // Idempotency guard #2: only ACTIVE (booked) bookings are refunded — never an
  // already-cancelled/attended/no_show one.
  const active = getBookings().filter((b) => b.slotId === slotId && b.status === 'booked');

  // Accumulate refunds per batch (two players on one slot could share a batch).
  const batchById = new Map(getBatches().map((b) => [b.id as string, b]));
  const increments = new Map<string, number>();
  for (const b of active) {
    increments.set(b.creditBatchId, (increments.get(b.creditBatchId) ?? 0) + 1);
  }

  const updatedBatches: CreditBatch[] = [];
  for (const [batchId, inc] of increments) {
    const batch = batchById.get(batchId);
    if (!batch) continue;
    // Original expiry preserved; incremented even if already expired.
    updatedBatches.push({ ...batch, quantityRemaining: batch.quantityRemaining + inc });
  }

  const cancelledBookings: Booking[] = active.map((b) => ({
    ...b,
    status: 'cancelled',
    cancelledAt: now,
  }));
  const cancelledSlot: SessionSlot = { ...slot, status: 'cancelled', bookedCount: 0 };

  commitSessionCancellation(cancelledSlot, cancelledBookings, updatedBatches);
  return { ok: true, refundedCount: active.length, affectedBookingIds: active.map((b) => b.id) };
}
