import { isBatchUsable } from '@tpa/core';
import { MOCK_NOW } from '@tpa/mocks';
import type {
  BookingId,
  CoachId,
  CreditBatch,
  CreditBatchId,
  IsoInstant,
  Player,
  PlayerId,
  PurchaseId,
  SessionSlot,
  SlotId,
} from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addPlayerToSlot,
  classifyAdminBooking,
  isActivelyBooked,
  removeBooking,
} from './booking';
import { __resetStoreForTests, getBatches, getBookings, getPlayers, getSlots } from './store';

const now = MOCK_NOW;
const daysFrom = (n: number) => new Date(new Date(now).getTime() + n * 86_400_000).toISOString() as IsoInstant;

beforeEach(() => __resetStoreForTests());

const batch = (id: string) => getBatches().find((b) => b.id === id)!;
const booking = (id: string) => getBookings().find((b) => b.id === (id as BookingId))!;
const slotOf = (id: string) => getSlots().find((s) => s.id === id)!;

// --- Constructed inputs for the pure classifier ---
const mkSlot = (over: Partial<SessionSlot> = {}): SessionSlot => ({
  id: 'sl_x' as SlotId,
  coachId: 'co_hany' as CoachId,
  startsAt: daysFrom(5),
  endsAt: daysFrom(5),
  trainingType: 'group',
  capacity: 4,
  bookedCount: 0,
  gender: 'men',
  level: 'beginner',
  status: 'published',
  templateId: null,
  ...over,
});
const mkPlayer = (over: Partial<Player> = {}): Player => ({
  id: 'pl_x' as PlayerId,
  phone: '+201000000000',
  name: 'Test Player',
  gender: 'men',
  level: 'beginner',
  createdAt: now,
  ...over,
});
const groupBatch: CreditBatch = {
  id: 'cb_x' as CreditBatchId,
  playerId: 'pl_x' as PlayerId,
  source: 'purchase',
  purchaseId: 'pu_x' as PurchaseId,
  trainingType: 'group',
  quantityTotal: 4,
  quantityRemaining: 2,
  createdAt: now,
  expiresAt: daysFrom(20),
  note: null,
};

describe('classifyAdminBooking (override policy over canBookSlot)', () => {
  it('ok when the player matches and can pay', () => {
    const v = classifyAdminBooking(mkSlot(), mkPlayer(), [groupBatch], now, false);
    expect(v.kind).toBe('ok');
  });

  it('OVERRIDES a gender mismatch when the player can still pay + fit', () => {
    const v = classifyAdminBooking(mkSlot({ gender: 'men' }), mkPlayer({ gender: 'ladies' }), [groupBatch], now, false);
    expect(v.kind).toBe('override');
    expect(v.kind === 'override' && v.reason).toBe('gender_mismatch');
  });

  it('OVERRIDES a level mismatch', () => {
    const v = classifyAdminBooking(mkSlot({ level: 'beginner' }), mkPlayer({ level: 'intermediate' }), [groupBatch], now, false);
    expect(v.kind).toBe('override');
    expect(v.kind === 'override' && v.reason).toBe('level_mismatch');
  });

  it('does NOT override full', () => {
    const v = classifyAdminBooking(mkSlot({ capacity: 4, bookedCount: 4 }), mkPlayer(), [groupBatch], now, false);
    expect(v).toEqual({ kind: 'blocked', reason: 'slot_full' });
  });

  it('does NOT override already-booked', () => {
    const v = classifyAdminBooking(mkSlot(), mkPlayer(), [groupBatch], now, true);
    expect(v).toEqual({ kind: 'blocked', reason: 'already_booked' });
  });

  it('does NOT override no usable credit', () => {
    const v = classifyAdminBooking(mkSlot(), mkPlayer(), [], now, false);
    expect(v).toEqual({ kind: 'blocked', reason: 'no_usable_credit' });
  });

  it('a hard block hiding behind a mismatch wins (mismatch + no credit → blocked, not override)', () => {
    const v = classifyAdminBooking(mkSlot({ gender: 'men' }), mkPlayer({ gender: 'ladies' }), [], now, false);
    expect(v).toEqual({ kind: 'blocked', reason: 'no_usable_credit' });
  });

  it('an expired credit is not usable → blocked', () => {
    const expired = { ...groupBatch, expiresAt: daysFrom(-1) };
    const v = classifyAdminBooking(mkSlot(), mkPlayer(), [expired], now, false);
    expect(v).toEqual({ kind: 'blocked', reason: 'no_usable_credit' });
  });
});

/** Find a real (slot, player) the admin can book with no override. */
function findAddable(): { slotId: SlotId; playerId: PlayerId; creditBatchId: string } {
  for (const s of getSlots()) {
    if (s.status !== 'published' || new Date(s.startsAt).getTime() <= new Date(now).getTime()) continue;
    if (s.bookedCount >= s.capacity) continue;
    for (const p of getPlayers()) {
      const batches = getBatches().filter((b) => b.playerId === p.id);
      const v = classifyAdminBooking(s, p, batches, now, isActivelyBooked(s.id, p.id));
      if (v.kind === 'ok') return { slotId: s.id, playerId: p.id, creditBatchId: v.creditBatchId };
    }
  }
  throw new Error('no addable (slot, player) in fixtures');
}

describe('addPlayerToSlot', () => {
  it('books the player, spends the named batch, records creditBatchId, takes a seat', () => {
    const { slotId, playerId, creditBatchId } = findAddable();
    const beforeQty = batch(creditBatchId).quantityRemaining;
    const beforeSeats = slotOf(slotId).bookedCount;

    const res = addPlayerToSlot(slotId, playerId, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.overridden).toBe(false);
    expect(res.booking.creditBatchId).toBe(creditBatchId); // earliest-expiring, chosen by core
    expect(res.booking.status).toBe('booked');
    expect(batch(creditBatchId).quantityRemaining).toBe(beforeQty - 1);
    expect(slotOf(slotId).bookedCount).toBe(beforeSeats + 1);
  });

  it('rejects a second booking of the same player on the same slot', () => {
    const { slotId, playerId } = findAddable();
    expect(addPlayerToSlot(slotId, playerId, now).ok).toBe(true);
    const res = addPlayerToSlot(slotId, playerId, now);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.reason).toBe('already_booked');
  });
});

describe('removeBooking', () => {
  it('refund path: frees the seat and returns the credit with original expiry', () => {
    const bk = booking('bk_booked'); // pl_omar, group slot, cb_group_main
    const batchId = bk.creditBatchId;
    const beforeQty = batch(batchId).quantityRemaining;
    const beforeExp = batch(batchId).expiresAt;
    const beforeSeats = slotOf(bk.slotId).bookedCount;

    const res = removeBooking('bk_booked' as BookingId, now, true);
    expect(res.ok && res.refunded).toBe(true);
    expect(batch(batchId).quantityRemaining).toBe(beforeQty + 1);
    expect(batch(batchId).expiresAt).toBe(beforeExp); // never extended
    expect(booking('bk_booked').status).toBe('cancelled');
    expect(slotOf(bk.slotId).bookedCount).toBe(beforeSeats - 1);
  });

  it('forfeit path: frees the seat but returns nothing', () => {
    const bk = booking('bk_booked');
    const batchId = bk.creditBatchId;
    const beforeQty = batch(batchId).quantityRemaining;
    const beforeSeats = slotOf(bk.slotId).bookedCount;

    const res = removeBooking('bk_booked' as BookingId, now, false);
    expect(res.ok && res.refunded).toBe(false);
    expect(batch(batchId).quantityRemaining).toBe(beforeQty); // forfeited
    expect(slotOf(bk.slotId).bookedCount).toBe(beforeSeats - 1); // seat freed anyway
    expect(booking('bk_booked').status).toBe('cancelled');
  });

  it('refunds to an already-expired batch anyway; it stays unusable', () => {
    const bk = booking('bk_expired_refund'); // cb_duo_expired
    const batchId = bk.creditBatchId;
    expect(isBatchUsable(batch(batchId), 'duo', now)).toBe(false);
    const beforeQty = batch(batchId).quantityRemaining;
    removeBooking('bk_expired_refund' as BookingId, now, true);
    expect(batch(batchId).quantityRemaining).toBe(beforeQty + 1);
    expect(isBatchUsable(batch(batchId), 'duo', now)).toBe(false);
  });

  it('is idempotent — re-removing never double-refunds', () => {
    const batchId = booking('bk_booked').creditBatchId;
    removeBooking('bk_booked' as BookingId, now, true);
    const afterFirst = batch(batchId).quantityRemaining;
    const res2 = removeBooking('bk_booked' as BookingId, now, true);
    expect(res2.ok).toBe(false);
    expect(res2.ok ? null : res2.reason).toBe('already_cancelled');
    expect(batch(batchId).quantityRemaining).toBe(afterFirst); // no second refund
  });

  it('rejects a missing booking', () => {
    const res = removeBooking('bk_nope' as BookingId, now, true);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.reason).toBe('booking_missing');
  });
});
