import { cairoCalendarDate } from '@tpa/core';
import type { Booking, BookingId, CreditBatchId, PlayerId, SessionSlot } from '@tpa/types';

import { MOCK_NOW, daysFromNow } from './now';
import { mockSlots } from './schedule';

const nowMs = new Date(MOCK_NOW).getTime();
const today = cairoCalendarDate(MOCK_NOW);
const past = mockSlots.filter((s) => new Date(s.startsAt).getTime() < nowMs);
const future = mockSlots
  .filter((s) => new Date(s.startsAt).getTime() > nowMs && s.status === 'published')
  .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

// Fixtures assume the window yields past and future slots (it does; see schedule).
const pick = (list: SessionSlot[], i: number): SessionSlot => {
  const slot = list[i];
  if (!slot) throw new Error(`mocks/bookings: expected a slot at index ${i}`);
  return slot;
};

// The current player's booked session: a men's-beginner group slot on a future
// open day other than today (today's men-beginner slots stay full/bookable), so
// the Book screen's "Booked" state is testable when that day is selected.
const bookedGroupSlot =
  future.find((s) => {
    if (s.trainingType !== 'group' || s.gender !== 'men' || s.level !== 'beginner') return false;
    const c = cairoCalendarDate(s.startsAt);
    return !(c.year === today.year && c.month === today.month && c.day === today.day);
  }) ?? pick(future, 0);

/**
 * One booking in each BookingStatus for the current player (pl_omar). `attended`
 * and `no_show` reference past sessions; `booked` and `cancelled` reference
 * upcoming ones. `creditBatchId` records which batch paid, so a refund knows
 * where to return the credit with its original expiry.
 */
export const mockBookings: Booking[] = [
  {
    id: 'bk_booked' as BookingId,
    slotId: bookedGroupSlot.id,
    playerId: 'pl_omar' as PlayerId,
    creditBatchId: 'cb_group_main' as CreditBatchId,
    status: 'booked',
    bookedAt: daysFromNow(-1),
    cancelledAt: null,
  },
  {
    id: 'bk_cancelled' as BookingId,
    slotId: pick(future, 1).id,
    playerId: 'pl_omar' as PlayerId,
    creditBatchId: 'cb_group_main' as CreditBatchId,
    status: 'cancelled',
    bookedAt: daysFromNow(-2),
    cancelledAt: daysFromNow(-1),
  },
  {
    id: 'bk_attended' as BookingId,
    slotId: pick(past, 0).id,
    playerId: 'pl_omar' as PlayerId,
    creditBatchId: 'cb_group_main' as CreditBatchId,
    status: 'attended',
    bookedAt: daysFromNow(-6),
    cancelledAt: null,
  },
  {
    id: 'bk_no_show' as BookingId,
    slotId: pick(past, 1).id,
    playerId: 'pl_omar' as PlayerId,
    creditBatchId: 'cb_group_main' as CreditBatchId,
    status: 'no_show',
    bookedAt: daysFromNow(-7),
    cancelledAt: null,
  },
];
