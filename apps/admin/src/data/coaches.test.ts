import { MOCK_NOW, mockBookings, mockSlots } from '@tpa/mocks';
import type { CoachId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// coaches.ts imports lib/api → lib/supabase, whose module-load env guard throws
// under the node test env. We only exercise the pure coachWeekStats here (it never
// touches the client), so stub the client module to get past the import guard.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { coachWeekStats } from './coaches';

/**
 * coachWeekStats is pure over the fetched rows. S10b moved coach CRUD
 * (createCoach/updateCoach/setCoachActive + template pausing) to async RLS writes,
 * proven server-side — so those tests are gone; only the stat derivation is unit-
 * testable here. Slots carry bookedCount reconciled from bookings, as the old store
 * seeded them.
 */

const now = MOCK_NOW;

/** Slots with bookedCount reconciled from non-cancelled bookings (old store seeding). */
function seededSlots() {
  const seats = new Map<string, number>();
  for (const b of mockBookings) if (b.status !== 'cancelled') seats.set(b.slotId, (seats.get(b.slotId) ?? 0) + 1);
  return mockSlots.map((s) => ({ ...s, bookedCount: seats.get(s.id) ?? 0 }));
}

describe('coachWeekStats — computed from the fetched rows', () => {
  it('counts this-week sessions/seats and buckets types, cross-checked by hand', () => {
    const slots = seededSlots();
    const coachId = slots[0]!.coachId;
    const stats = coachWeekStats(slots, mockBookings, coachId, now);
    // sessions this week == sum of the per-type chip counts
    const chipTotal = stats.typeCounts.reduce((s, c) => s + c.count, 0);
    expect(chipTotal).toBe(stats.sessionsThisWeek);
    expect(stats.seatsBooked).toBeGreaterThanOrEqual(0);
    expect(stats.attendancePct === null || (stats.attendancePct >= 0 && stats.attendancePct <= 100)).toBe(true);
  });

  it('a coach with no sessions this week reads zero and no chips (empty state)', () => {
    // A coach id that owns no slots at all.
    const stats = coachWeekStats(seededSlots(), mockBookings, 'co_ghost' as CoachId, now);
    expect(stats.sessionsThisWeek).toBe(0);
    expect(stats.seatsBooked).toBe(0);
    expect(stats.typeCounts).toEqual([]);
    expect(stats.attendancePct).toBe(null);
  });
});
