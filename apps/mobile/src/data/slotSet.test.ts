import type { Booking, BookingId, PlayerId, SessionSlot, SlotId, LocationId, CreditBatchId, IsoInstant, CoachId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { mergeSlots, missingSlotIds } from './slotSet';

const slot = (id: string, locationId = 'loc_oro'): SessionSlot => ({
  id: id as SlotId,
  locationId: locationId as LocationId,
  coachId: 'co_1' as CoachId,
  startsAt: '2026-10-01T10:00:00.000Z' as IsoInstant,
  endsAt: '2026-10-01T11:00:00.000Z' as IsoInstant,
  trainingType: 'group',
  capacity: 4,
  bookedCount: 1,
  gender: 'men',
  level: 'beginner',
  status: 'published',
  templateId: null,
  manuallyConfirmedAt: null,
  setByBookingAt: null,
});

const booking = (id: string, slotId: string): Booking => ({
  id: id as BookingId,
  slotId: slotId as SlotId,
  locationId: 'loc_oro' as LocationId,
  playerId: 'pl_1' as PlayerId,
  creditBatchId: 'cb_1' as CreditBatchId,
  status: 'booked',
  bookedAt: '2026-09-01T00:00:00.000Z' as IsoInstant,
  cancelledAt: null,
});

describe('missingSlotIds', () => {
  // The whole point: a booking at Branch B while Branch A is selected.
  it('finds a booked slot the branch-filtered feed does not contain', () => {
    expect(missingSlotIds([booking('bk_1', 'sl_at_b')], [slot('sl_at_a')])).toEqual(['sl_at_b']);
  });

  it('is empty when every booking is already in the feed', () => {
    expect(missingSlotIds([booking('bk_1', 'sl_a')], [slot('sl_a')])).toEqual([]);
  });

  it('de-duplicates two bookings on the same missing slot', () => {
    const out = missingSlotIds([booking('bk_1', 'sl_x'), booking('bk_2', 'sl_x')], []);
    expect(out).toEqual(['sl_x']);
  });

  // A stable array means a stable query key; an unsorted Set would refetch
  // whenever iteration order shifted.
  it('is sorted, so the query key built from it is stable', () => {
    expect(missingSlotIds([booking('b1', 'sl_c'), booking('b2', 'sl_a')], [])).toEqual(['sl_a', 'sl_c']);
  });

  it('includes cancelled bookings — the Past list shows those too', () => {
    const cancelled = { ...booking('bk_1', 'sl_gone'), status: 'cancelled' as const };
    expect(missingSlotIds([cancelled], [])).toEqual(['sl_gone']);
  });

  it('is empty with no bookings', () => {
    expect(missingSlotIds([], [slot('sl_a')])).toEqual([]);
  });
});

describe('mergeSlots', () => {
  it('returns the feed untouched when nothing was missing', () => {
    expect(mergeSlots([slot('sl_a')], []).map((s) => s.id)).toEqual(['sl_a']);
  });

  it('adds the cross-branch slot to the feed', () => {
    const out = mergeSlots([slot('sl_a')], [slot('sl_b', 'loc_qa')]);
    expect(out.map((s) => s.id).sort()).toEqual(['sl_a', 'sl_b']);
  });

  it('never duplicates a slot present in both', () => {
    const out = mergeSlots([slot('sl_a')], [slot('sl_a')]);
    expect(out).toHaveLength(1);
  });

  // The feed is the fresher read; the by-id fetch only fills gaps.
  it('prefers the feed copy on conflict', () => {
    const stale = { ...slot('sl_a'), bookedCount: 99 };
    const out = mergeSlots([slot('sl_a')], [stale]);
    expect(out[0]!.bookedCount).toBe(1);
  });
});
