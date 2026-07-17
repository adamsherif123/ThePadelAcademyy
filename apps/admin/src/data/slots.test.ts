import { parseInstant } from '@tpa/core';
import { MOCK_NOW, mockBookings, mockSlots } from '@tpa/mocks';
import type { IsoInstant, SlotId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// slots.ts imports lib/api → lib/supabase, whose module-load env guard throws under
// the node test env. We only exercise pure math + the pre-network validation
// rejections (which never reach the client), so stub it past the import guard.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { findCoachConflict, slotTimesFromWall } from './schedule';
import { updateSlotDetails } from './slots';

/**
 * slotTimesFromWall and findCoachConflict are pure (over the fetched slots).
 * updateSlotDetails is now an async, column-limited UPDATE whose FIRST arg is the
 * full current slot; only its client-side VALIDATION rejections (which return before
 * any network call) are unit-testable — the happy-path commit is proven server-side.
 */

const now = MOCK_NOW;
const ms = (i: IsoInstant) => parseInstant(i).getTime();

/** Slots with bookedCount reconciled from non-cancelled bookings (old store seeding). */
function seededSlots() {
  const seats = new Map<string, number>();
  for (const b of mockBookings) if (b.status !== 'cancelled') seats.set(b.slotId, (seats.get(b.slotId) ?? 0) + 1);
  return mockSlots.map((s) => ({ ...s, bookedCount: seats.get(s.id) ?? 0 }));
}

describe('slotTimesFromWall (Cairo → UTC via @tpa/core, DST-correct)', () => {
  it('applies the SUMMER offset (+03) — 6 PM Cairo on 20 Jul = 15:00 UTC', () => {
    const { startsAt, endsAt } = slotTimesFromWall(2026, 7, 20, 18 * 60, 120);
    expect(startsAt).toBe('2026-07-20T15:00:00.000Z');
    expect(endsAt).toBe('2026-07-20T17:00:00.000Z'); // 8 PM Cairo
  });

  it('applies the WINTER offset (+02) — 6 PM Cairo on 20 Jan = 16:00 UTC', () => {
    const { startsAt, endsAt } = slotTimesFromWall(2026, 1, 20, 18 * 60, 120);
    expect(startsAt).toBe('2026-01-20T16:00:00.000Z');
    expect(endsAt).toBe('2026-01-20T18:00:00.000Z');
    // Same wall times, one hour of UTC apart from summer → the offset is not hand-rolled.
    expect(ms(startsAt) - ms(slotTimesFromWall(2026, 7, 20, 18 * 60, 120).startsAt)).not.toBe(0);
  });

  it('preserves the duration when the start moves (wholesale reschedule)', () => {
    const at6 = slotTimesFromWall(2026, 7, 20, 18 * 60, 120);
    const at7 = slotTimesFromWall(2026, 7, 20, 19 * 60, 120);
    expect(ms(at6.endsAt) - ms(at6.startsAt)).toBe(120 * 60000);
    expect(ms(at7.endsAt) - ms(at7.startsAt)).toBe(120 * 60000);
  });

  it('rolls the date forward when the session crosses midnight', () => {
    const { endsAt } = slotTimesFromWall(2026, 7, 20, 23 * 60, 120); // 11 PM + 2h → 1 AM Cairo on the 21st
    expect(endsAt).toBe('2026-07-20T22:00:00.000Z'); // 1 AM Cairo Jul 21 = 22:00 UTC Jul 20 (−3)
  });
});

describe('findCoachConflict', () => {
  it("flags another of the coach's slots overlapping the time; excludes self; ignores touching", () => {
    const slots = mockSlots;
    const a = slots.find((s) => s.status === 'published')!;
    // Overlapping A's own window (not excluding A) → a conflict for A's coach.
    const hit = findCoachConflict(slots, a.coachId, a.startsAt, a.endsAt, 'sl_none' as SlotId);
    expect(hit).toBeDefined();
    expect(hit!.coachId).toBe(a.coachId);
    // Excluding A → A itself is never returned as its own conflict.
    expect(findCoachConflict(slots, a.coachId, a.startsAt, a.endsAt, a.id)?.id).not.toBe(a.id);
    // A window that starts exactly when A ends touches but does NOT overlap.
    const after = a.endsAt;
    const afterEnd = new Date(ms(a.endsAt) + 60 * 60000).toISOString() as IsoInstant;
    expect(findCoachConflict(slots, a.coachId, after, afterEnd, a.id)?.id).not.toBe(a.id);
  });
});

describe('updateSlotDetails — validation rejections (return before any network call)', () => {
  const future = slotTimesFromWall(2026, 7, 26, 18 * 60, 120); // a future Cairo evening

  const bookedSlot = () => {
    const withBookings = seededSlots().find((s) => s.status === 'published' && s.bookedCount > 0);
    if (!withBookings) throw new Error('no booked slot in fixtures');
    return withBookings;
  };

  it('rejects end before or equal to start', async () => {
    const slot = bookedSlot();
    const res = await updateSlotDetails(
      slot,
      { coachId: slot.coachId, capacity: slot.capacity, startsAt: future.endsAt, endsAt: future.startsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('end_before_start');
  });

  it('rejects moving the start into the past', async () => {
    const slot = bookedSlot();
    const past = slotTimesFromWall(2026, 7, 10, 18 * 60, 120); // before MOCK_NOW (15 Jul)
    const res = await updateSlotDetails(
      slot,
      { coachId: slot.coachId, capacity: slot.capacity, startsAt: past.startsAt, endsAt: past.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('in_past');
  });

  it('still rejects capacity below the booked count', async () => {
    const slot = bookedSlot();
    const res = await updateSlotDetails(
      slot,
      { coachId: slot.coachId, capacity: slot.bookedCount - 1, startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('capacity_below_booked');
  });
});
