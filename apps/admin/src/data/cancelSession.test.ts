import { isBatchUsable, isCancellableWithoutForfeit } from '@tpa/core';
import { MOCK_NOW } from '@tpa/mocks';
import type { BookingId, IsoInstant, SlotId } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { cancelSession } from './cancelSession';
import { __resetStoreForTests, getBatches, getBookings, getSlots } from './store';

const now = MOCK_NOW;

beforeEach(() => __resetStoreForTests());

const batch = (id: string) => getBatches().find((b) => b.id === id)!;
const booking = (id: string) => getBookings().find((b) => b.id === (id as BookingId))!;
const slot = (id: string) => getSlots().find((s) => s.id === id)!;

/** A slot id that has at least one active (booked) booking. */
function slotWithBooked(): SlotId {
  const counts = new Map<string, number>();
  for (const b of getBookings()) {
    if (b.status === 'booked') counts.set(b.slotId, (counts.get(b.slotId) ?? 0) + 1);
  }
  const entry = [...counts.entries()].find(([, n]) => n >= 1);
  if (!entry) throw new Error('no slot with a booked booking in fixtures');
  return entry[0] as SlotId;
}

describe('cancelSession', () => {
  it('refunds every booked player to their original batch, keeping original expiry', () => {
    const slotId = slotWithBooked();
    const active = getBookings().filter((b) => b.slotId === slotId && b.status === 'booked');

    // Per-batch refund count + captured originals (two players may share a batch).
    const counts = new Map<string, number>();
    const original = new Map<string, { qty: number; exp: IsoInstant }>();
    for (const b of active) {
      counts.set(b.creditBatchId, (counts.get(b.creditBatchId) ?? 0) + 1);
      if (!original.has(b.creditBatchId)) {
        original.set(b.creditBatchId, {
          qty: batch(b.creditBatchId).quantityRemaining,
          exp: batch(b.creditBatchId).expiresAt,
        });
      }
    }

    const res = cancelSession(slotId, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refundedCount).toBe(active.length);

    for (const [batchId, n] of counts) {
      const o = original.get(batchId)!;
      expect(batch(batchId).quantityRemaining).toBe(o.qty + n); // +1 per player
      expect(batch(batchId).expiresAt).toBe(o.exp); // original expiry — never buys time
    }
    for (const b of active) {
      expect(booking(b.id).status).toBe('cancelled');
      expect(booking(b.id).cancelledAt).toBe(now);
    }
    expect(slot(slotId).status).toBe('cancelled');
  });

  it('refunds even INSIDE the 3-hour window (academy fault ≠ player forfeit)', () => {
    const bk = booking('bk_soon'); // slot starts 2h out — inside the window
    const before = batch(bk.creditBatchId).quantityRemaining;
    expect(isCancellableWithoutForfeit(slot(bk.slotId), now)).toBe(false);
    const res = cancelSession(bk.slotId as SlotId, now);
    expect(res.ok).toBe(true);
    expect(batch(bk.creditBatchId).quantityRemaining).toBe(before + 1); // refunded anyway
  });

  it('refunds to an already-expired batch anyway; it stays unusable', () => {
    const bk = booking('bk_expired_refund'); // paid from cb_duo_expired
    expect(isBatchUsable(batch(bk.creditBatchId), 'duo', now)).toBe(false);
    const before = batch(bk.creditBatchId).quantityRemaining;
    cancelSession(bk.slotId as SlotId, now);
    expect(batch(bk.creditBatchId).quantityRemaining).toBe(before + 1); // ledger truth
    expect(isBatchUsable(batch(bk.creditBatchId), 'duo', now)).toBe(false); // still worthless
  });

  it('is idempotent — re-cancelling never double-refunds N players', () => {
    const slotId = slotWithBooked();
    const active = getBookings().filter((b) => b.slotId === slotId && b.status === 'booked');
    cancelSession(slotId, now);
    const afterFirst = new Map(active.map((b) => [b.creditBatchId, batch(b.creditBatchId).quantityRemaining]));

    const res2 = cancelSession(slotId, now);
    expect(res2.ok).toBe(false);
    expect(res2.ok ? null : res2.reason).toBe('already_cancelled');
    for (const [batchId, qty] of afterFirst) {
      expect(batch(batchId).quantityRemaining).toBe(qty); // no second refund
    }
  });

  it('cancels a slot with zero bookings — ok, no refunds', () => {
    const empty = getSlots().find(
      (s) => s.status === 'published' && !getBookings().some((b) => b.slotId === s.id && b.status === 'booked'),
    );
    expect(empty).toBeDefined();
    const res = cancelSession(empty!.id, now);
    expect(res.ok).toBe(true);
    expect(res.ok && res.refundedCount).toBe(0);
    expect(slot(empty!.id).status).toBe('cancelled');
  });

  it('rejects a missing slot', () => {
    const res = cancelSession('sl_nope' as SlotId, now);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.reason).toBe('slot_missing');
  });
});
