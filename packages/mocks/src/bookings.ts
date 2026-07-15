import type { Booking, BookingId, CreditBatchId, PlayerId, SessionSlot } from '@tpa/types';

import { MOCK_NOW, daysFromNow } from './now';
import { mockSlots } from './schedule';

const nowMs = new Date(MOCK_NOW).getTime();
const past = mockSlots.filter((s) => new Date(s.startsAt).getTime() < nowMs);
const future = mockSlots.filter(
  (s) => new Date(s.startsAt).getTime() > nowMs && s.status === 'published',
);

// Fixtures assume the window yields past and future slots (it does; see schedule).
const pick = (list: SessionSlot[], i: number): SessionSlot => {
  const slot = list[i];
  if (!slot) throw new Error(`mocks/bookings: expected a slot at index ${i}`);
  return slot;
};

/**
 * One booking in each BookingStatus for the current player (pl_omar). `attended`
 * and `no_show` reference past sessions; `booked` and `cancelled` reference
 * upcoming ones. `creditBatchId` records which batch paid, so a refund knows
 * where to return the credit with its original expiry.
 */
export const mockBookings: Booking[] = [
  {
    id: 'bk_booked' as BookingId,
    slotId: pick(future, 0).id,
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
