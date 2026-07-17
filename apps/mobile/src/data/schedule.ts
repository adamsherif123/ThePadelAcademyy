import type { Booking, Coach, IsoInstant, SessionSlot } from '@tpa/types';

/**
 * Schedule derivation — pure over the player's bookings, the published slots, and
 * the coaches (all fetched by the query layer, S9). Screens render dates via
 * @tpa/core. (Catalog helpers live in catalog.ts.)
 */

export interface NextSession {
  slot: SessionSlot;
  coach: Coach | undefined;
}

/** The player's soonest upcoming booked session, joined to its coach. */
export function nextSession(
  bookings: Booking[],
  slots: SessionSlot[],
  coaches: Coach[],
  now: IsoInstant,
): NextSession | null {
  const nowMs = new Date(now).getTime();
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const upcoming = bookings
    .filter((b) => b.status === 'booked')
    .map((b) => slotById.get(b.slotId))
    .filter((s): s is SessionSlot => !!s && new Date(s.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const slot = upcoming[0];
  if (!slot) return null;
  return { slot, coach: coaches.find((c) => c.id === slot.coachId) };
}
