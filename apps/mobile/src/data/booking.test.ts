import { canBookSlot, isBatchUsable, isCancellableWithoutForfeit } from '@tpa/core';
import { MOCK_NOW, mockCurrentPlayer } from '@tpa/mocks';
import type { BookingId, IsoInstant, PlayerId, SessionSlot } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { bookSlot, bookedSlotIds, cancelBooking, type CancelResult } from './booking';
import { __resetStoreForTests, getBatches, getBookings, getSlots } from './store';

/**
 * Permanent coverage for the two mutation seams that move money-equivalent value:
 * bookSlot (spend a credit) and cancelBooking (conditionally refund one). Both had
 * real bugs — the S3d double-spend and the S3e double-refund — caught by throwaway
 * scripts; this is that spec, committed. When S7 swaps these bodies for atomic DB
 * RPCs, these become the regression net. Runs against the mock store, reset before
 * each case via the test-only seed hook.
 */

const player = mockCurrentPlayer; // pl_omar — men / beginner
const now = MOCK_NOW;

beforeEach(() => __resetStoreForTests());

const batch = (id: string) => getBatches().find((b) => b.id === id);
const booking = (id: string) => getBookings().find((b) => b.id === (id as BookingId));
const slot = (id: string): SessionSlot => {
  const s = getSlots().find((x) => x.id === id);
  if (!s) throw new Error(`no slot ${id}`);
  return s;
};
const slotOf = (bookingId: string) => slot(booking(bookingId)!.slotId);
const reasonOf = (r: CancelResult) => (r.ok ? null : r.reason);

/** First slot pl_omar can book right now of a given type, that he hasn't booked. */
function findBookable(trainingType: string): SessionSlot {
  const booked = bookedSlotIds(player.id);
  const s = getSlots().find(
    (x) =>
      !booked.has(x.id) &&
      x.trainingType === trainingType &&
      canBookSlot(x, player, getBatches(), now).ok,
  );
  if (!s) throw new Error(`no bookable ${trainingType} slot in fixtures`);
  return s;
}

/** A slot (not already booked) that core says fails for exactly `reason`. */
function findByReason(reason: string): SessionSlot {
  const booked = bookedSlotIds(player.id);
  const s = getSlots().find((x) => {
    if (booked.has(x.id)) return false;
    const v = canBookSlot(x, player, getBatches(), now);
    return !v.ok && v.reason === reason;
  });
  if (!s) throw new Error(`no fixture slot yields reason ${reason}`);
  return s;
}

describe('bookSlot', () => {
  it('spends the earliest-expiring usable batch, records it, and takes a seat', () => {
    const s = findBookable('group');
    const seatsBefore = slot(s.id).bookedCount;
    // pl_omar's usable group batches: cb_group_main (+25d) and cb_group_expiring
    // (+2d). Earliest-expiring wins, so the +2d batch is spent.
    const qtyBefore = batch('cb_group_expiring')!.quantityRemaining;

    const res = bookSlot(player, s.id, now);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.booking.creditBatchId).toBe('cb_group_expiring');
    expect(res.batch.id).toBe('cb_group_expiring');
    expect(batch('cb_group_expiring')!.quantityRemaining).toBe(qtyBefore - 1);
    expect(slot(s.id).bookedCount).toBe(seatsBefore + 1);
  });

  it('rejects a second booking of the same slot — no double-spend', () => {
    const s = findBookable('group');
    const first = bookSlot(player, s.id, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const spent = first.batch.id;
    const qtyAfterFirst = batch(spent)!.quantityRemaining;
    const seatsAfterFirst = slot(s.id).bookedCount;

    const second = bookSlot(player, s.id, now);

    expect(second.ok).toBe(false);
    expect(second.ok ? null : second.reason).toBe('already_booked');
    expect(batch(spent)!.quantityRemaining).toBe(qtyAfterFirst); // no second decrement
    expect(slot(s.id).bookedCount).toBe(seatsAfterFirst); // no second seat
  });

  it.each([
    'slot_cancelled',
    'slot_in_past',
    'slot_full',
    'gender_mismatch',
    'level_mismatch',
    'no_usable_credit',
  ])('rejects the %s block reason', (reason) => {
    const s = findByReason(reason);
    const res = bookSlot(player, s.id, now);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.reason).toBe(reason);
  });
});

describe('cancelBooking', () => {
  it('outside the window: refunds to the original batch with its original expiry, frees the seat', () => {
    const s = slotOf('bk_booked');
    const batchId = booking('bk_booked')!.creditBatchId; // cb_group_main
    const qtyBefore = batch(batchId)!.quantityRemaining;
    const expiryBefore = batch(batchId)!.expiresAt;
    const seatsBefore = s.bookedCount;
    expect(isCancellableWithoutForfeit(s, now)).toBe(true);

    const res = cancelBooking(player, 'bk_booked' as BookingId, now);

    expect(res.ok && res.refunded).toBe(true);
    expect(batch(batchId)!.quantityRemaining).toBe(qtyBefore + 1);
    expect(batch(batchId)!.expiresAt).toBe(expiryBefore); // NOT extended
    expect(slot(s.id).bookedCount).toBe(seatsBefore - 1);
    expect(booking('bk_booked')!.status).toBe('cancelled');
    expect(booking('bk_booked')!.cancelledAt).toBe(now);
  });

  it('rejects a second cancel — no double-refund', () => {
    cancelBooking(player, 'bk_booked' as BookingId, now);
    const qtyAfterFirst = batch('cb_group_main')!.quantityRemaining;

    const res = cancelBooking(player, 'bk_booked' as BookingId, now);

    expect(res.ok).toBe(false);
    expect(reasonOf(res)).toBe('already_cancelled');
    expect(batch('cb_group_main')!.quantityRemaining).toBe(qtyAfterFirst);
  });

  it('inside the window: frees the seat but forfeits the credit', () => {
    const s = slotOf('bk_soon');
    const batchId = booking('bk_soon')!.creditBatchId;
    const qtyBefore = batch(batchId)!.quantityRemaining;
    const seatsBefore = s.bookedCount;
    expect(isCancellableWithoutForfeit(s, now)).toBe(false);

    const res = cancelBooking(player, 'bk_soon' as BookingId, now);

    expect(res.ok).toBe(true);
    expect(res.ok && res.refunded).toBe(false);
    expect(batch(batchId)!.quantityRemaining).toBe(qtyBefore); // no refund
    expect(slot(s.id).bookedCount).toBe(seatsBefore - 1); // seat still freed
  });

  it('expired-batch edge: returns the credit anyway, and it stays unusable', () => {
    const batchId = booking('bk_expired_refund')!.creditBatchId; // cb_duo_expired
    const qtyBefore = batch(batchId)!.quantityRemaining;
    expect(isBatchUsable(batch(batchId)!, 'duo', now)).toBe(false);

    const res = cancelBooking(player, 'bk_expired_refund' as BookingId, now);

    expect(res.ok && res.refunded).toBe(true); // the ledger tells the truth
    expect(batch(batchId)!.quantityRemaining).toBe(qtyBefore + 1);
    expect(isBatchUsable(batch(batchId)!, 'duo', now)).toBe(false); // returned worthless
  });

  it('rejects terminal, missing, and non-owned bookings', () => {
    expect(reasonOf(cancelBooking(player, 'bk_attended' as BookingId, now))).toBe('not_cancellable');
    expect(reasonOf(cancelBooking(player, 'bk_no_show' as BookingId, now))).toBe('not_cancellable');
    expect(reasonOf(cancelBooking(player, 'bk_missing' as BookingId, now))).toBe('booking_missing');
    const other = { ...player, id: 'pl_other' as PlayerId };
    expect(reasonOf(cancelBooking(other, 'bk_booked' as BookingId, now))).toBe('not_owner');
  });

  it('the 3-hour boundary is exact: at startsAt − 3h forfeit, a millisecond earlier refundable', () => {
    const s = slotOf('bk_soon');
    const startMs = new Date(s.startsAt).getTime();
    const exactly3h = new Date(startMs - 3 * 3_600_000).toISOString() as IsoInstant;
    const oneMsEarlier = new Date(startMs - 3 * 3_600_000 - 1).toISOString() as IsoInstant;
    expect(isCancellableWithoutForfeit(s, exactly3h)).toBe(false);
    expect(isCancellableWithoutForfeit(s, oneMsEarlier)).toBe(true);
  });
});
