import { mockCoaches } from '@tpa/mocks';
import type { Coach, IsoInstant, PlayerId, SessionSlot } from '@tpa/types';

import { getBookings, getSlots } from './store';

/**
 * Schedule selectors over the store (seeded from @tpa/mocks, mutated by bookings).
 * Pure; S9 swaps the bodies for real queries. Screens render dates via @tpa/core.
 * (Catalog helpers live in catalog.ts.)
 */

export interface NextSession {
  slot: SessionSlot;
  coach: Coach | undefined;
}

/** The player's soonest upcoming booked session, joined to its coach. */
export function nextSession(playerId: PlayerId, now: IsoInstant): NextSession | null {
  const nowMs = new Date(now).getTime();
  const slotById = new Map(getSlots().map((s) => [s.id, s]));

  const upcoming = getBookings()
    .filter((b) => b.playerId === playerId && b.status === 'booked')
    .map((b) => slotById.get(b.slotId))
    .filter((s): s is SessionSlot => !!s && new Date(s.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const slot = upcoming[0];
  if (!slot) return null;
  return { slot, coach: mockCoaches.find((c) => c.id === slot.coachId) };
}

/** All coaches (for the Meet the Coaches screen). */
export function allCoaches(): Coach[] {
  return mockCoaches;
}
