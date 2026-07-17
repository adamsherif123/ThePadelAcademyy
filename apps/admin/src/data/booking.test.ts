import { MOCK_NOW, mockBookings } from '@tpa/mocks';
import type {
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
import { describe, expect, it, vi } from 'vitest';

// booking.ts imports lib/api → lib/supabase, whose module-load env guard throws
// under the node test env. classifyAdminBooking / isActivelyBooked are pure (never
// touch the client), so stub the client module to get past the import guard.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { classifyAdminBooking, isActivelyBooked } from './booking';

/**
 * classifyAdminBooking (the admin override policy over @tpa/core's canBookSlot) and
 * isActivelyBooked are still pure previews. S10b moved the writes (addPlayerToSlot /
 * removeBooking) to atomic RPCs, proven server-side — so their mutation tests are gone.
 */

const now = MOCK_NOW;
const daysFrom = (n: number) =>
  new Date(new Date(now).getTime() + n * 86_400_000).toISOString() as IsoInstant;

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

describe('isActivelyBooked', () => {
  it('true for a non-cancelled booking the player holds on the slot; false otherwise', () => {
    const active = mockBookings.find((b) => b.status !== 'cancelled');
    if (!active) throw new Error('no active booking in fixtures');
    expect(isActivelyBooked(mockBookings, active.slotId, active.playerId)).toBe(true);
    expect(isActivelyBooked(mockBookings, 'sl_nope' as SlotId, active.playerId)).toBe(false);
    expect(isActivelyBooked(mockBookings, active.slotId, 'pl_nope' as PlayerId)).toBe(false);
  });

  it('ignores a cancelled booking (a freed seat is not "actively booked")', () => {
    const cancelled = mockBookings.find((b) => b.status === 'cancelled');
    if (!cancelled) throw new Error('no cancelled booking in fixtures');
    // Only cancelled bookings for this (slot, player) → not actively booked.
    const others = mockBookings.filter(
      (b) => !(b.slotId === cancelled.slotId && b.playerId === cancelled.playerId && b.status !== 'cancelled'),
    );
    expect(isActivelyBooked(others, cancelled.slotId, cancelled.playerId)).toBe(false);
  });
});
