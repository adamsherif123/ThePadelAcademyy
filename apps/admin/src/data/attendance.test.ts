import { MOCK_NOW } from '@tpa/mocks';
import type { BookingId, IsoInstant } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { markAttendance } from './attendance';
import { creditLiability } from './dashboard';
import { __resetStoreForTests, getBatches, getBookings, getSlots } from './store';

beforeEach(() => __resetStoreForTests());

const shift = (iso: IsoInstant, hrs: number) =>
  new Date(new Date(iso).getTime() + hrs * 3_600_000).toISOString() as IsoInstant;

/** A booked booking + a `now` an hour after its session started. */
function bookedAfterStart() {
  const booking = getBookings().find((b) => b.status === 'booked');
  if (!booking) throw new Error('no booked booking in fixtures');
  const slot = getSlots().find((s) => s.id === booking.slotId)!;
  return { booking, afterStart: shift(slot.startsAt, 1), beforeStart: shift(slot.startsAt, -1) };
}

describe('markAttendance — a plain, reversible status flip', () => {
  it('marks attended and no_show, and reverses back to booked', () => {
    const { booking, afterStart } = bookedAfterStart();
    expect(markAttendance(booking.id, 'attended', afterStart).ok).toBe(true);
    expect(getBookings().find((b) => b.id === booking.id)!.status).toBe('attended');
    // Reversible without ceremony: mark no_show, then un-mark to booked.
    expect(markAttendance(booking.id, 'no_show', afterStart).ok).toBe(true);
    expect(getBookings().find((b) => b.id === booking.id)!.status).toBe('no_show');
    expect(markAttendance(booking.id, 'booked', afterStart).ok).toBe(true);
    expect(getBookings().find((b) => b.id === booking.id)!.status).toBe('booked');
  });

  it('refuses a session that has not started (attendance is meaningless in the future)', () => {
    const { booking, beforeStart } = bookedAfterStart();
    const res = markAttendance(booking.id, 'attended', beforeStart);
    expect(res.ok ? null : res.reason).toBe('session_not_started');
  });

  it('refuses a cancelled booking (it left the roster)', () => {
    const cancelled = getBookings().find((b) => b.status === 'cancelled');
    if (!cancelled) throw new Error('no cancelled booking in fixtures');
    const res = markAttendance(cancelled.id, 'attended', '2027-01-01T00:00:00.000Z' as IsoInstant);
    expect(res.ok ? null : res.reason).toBe('booking_cancelled');
  });

  it('is not money — credits and liability are untouched', () => {
    const { booking, afterStart } = bookedAfterStart();
    const batchesBefore = JSON.stringify(getBatches());
    const liabilityBefore = creditLiability(MOCK_NOW);
    markAttendance(booking.id, 'attended', afterStart);
    markAttendance(booking.id, 'no_show', afterStart);
    expect(JSON.stringify(getBatches())).toBe(batchesBefore); // no refund, no spend
    expect(creditLiability(MOCK_NOW)).toBe(liabilityBefore);
  });

  it('rejects an unknown booking', () => {
    const res = markAttendance('bk_nope' as BookingId, 'attended', MOCK_NOW);
    expect(res.ok ? null : res.reason).toBe('booking_missing');
  });
});
