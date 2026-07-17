import { parseInstant } from '@tpa/core';
import type { Booking, BookingId, IsoInstant } from '@tpa/types';

import { commitBookingStatus, getBookings, getSlots } from './store';

/**
 * Mark (or correct) attendance for one booking. Deliberately NOT money-equivalent:
 * the credit was spent at booking time and stays spent whether the player showed or
 * not — a no-show forfeits nothing extra, there was never a refund to withhold — so
 * this is a plain status flip with none of the ceremony cancelSession/removeBooking
 * carry. It's fully REVERSIBLE (the owner misclicks; a latecomer gets marked absent):
 * pass 'booked' to un-mark back to the neutral state.
 *
 * Only PAST sessions can be marked: attendance on a session that hasn't happened is
 * meaningless — you can't have attended (or missed) a session still in the future,
 * and pre-judging a booked player as a no-show would be nonsense — so the seam
 * refuses it rather than letting the UI be the only guard.
 */
export type AttendanceStatus = 'booked' | 'attended' | 'no_show';

export type MarkAttendanceResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_missing' | 'booking_cancelled' | 'session_not_started' };

export function markAttendance(
  bookingId: BookingId,
  status: AttendanceStatus,
  now: IsoInstant,
): MarkAttendanceResult {
  const booking = getBookings().find((b) => b.id === bookingId);
  if (!booking) return { ok: false, reason: 'booking_missing' };
  // A cancelled booking left the roster; attendance doesn't apply to it.
  if (booking.status === 'cancelled') return { ok: false, reason: 'booking_cancelled' };

  const slot = getSlots().find((s) => s.id === booking.slotId);
  if (!slot) return { ok: false, reason: 'booking_missing' };
  if (parseInstant(slot.startsAt).getTime() > parseInstant(now).getTime()) {
    return { ok: false, reason: 'session_not_started' };
  }

  const updated: Booking = { ...booking, status };
  commitBookingStatus(updated);
  return { ok: true, booking: updated };
}
