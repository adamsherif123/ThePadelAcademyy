import type { Booking, BookingStatus, Coach, Player, SessionSlot } from '@tpa/types';

import { getBookings, getCoaches, getPlayers, getSlots } from './store';

/**
 * The Bookings-screen read model: every booking joined to its player, session, and
 * coach, plus the status counts for the cards. Pure over the store; S10 swaps the
 * store internals for a Supabase view without the screen changing.
 */

export interface BookingRow {
  booking: Booking;
  player: Player | undefined;
  slot: SessionSlot | undefined;
  coach: Coach | undefined;
}

const ms = (i: string): number => new Date(i).getTime();

/** Every booking as an enriched row, most recent session first. */
export function bookingRows(): BookingRow[] {
  const playerById = new Map(getPlayers().map((p) => [p.id, p]));
  const slotById = new Map(getSlots().map((s) => [s.id, s]));
  const coachById = new Map(getCoaches().map((c) => [c.id, c]));
  return getBookings()
    .map((booking) => {
      const slot = slotById.get(booking.slotId);
      return {
        booking,
        player: playerById.get(booking.playerId),
        slot,
        coach: slot ? coachById.get(slot.coachId) : undefined,
      };
    })
    .sort((a, b) => (b.slot ? ms(b.slot.startsAt) : 0) - (a.slot ? ms(a.slot.startsAt) : 0));
}

export type BookingStatusCounts = Record<BookingStatus, number>;

/** All-time counts per status, for the four count cards. */
export function bookingStatusCounts(): BookingStatusCounts {
  const counts: BookingStatusCounts = { booked: 0, attended: 0, cancelled: 0, no_show: 0 };
  for (const b of getBookings()) counts[b.status] += 1;
  return counts;
}
