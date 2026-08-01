import type { Booking, BookingStatus, Coach, Player, SessionSlot } from '@tpa/types';

/**
 * The Bookings-screen read model: a booking joined to its player, session, and
 * coach. The rows themselves and the status counts are now server-side (a
 * bounded, paginated query and a count-only aggregate — see lib/api.ts's
 * fetchBookingsPage/fetchBookingStatusCounts) since the page no longer holds
 * every booking in memory; these two types are what both sides share.
 */

export interface BookingRow {
  booking: Booking;
  player: Player | undefined;
  slot: SessionSlot | undefined;
  coach: Coach | undefined;
}

export type BookingStatusCounts = Record<BookingStatus, number>;
