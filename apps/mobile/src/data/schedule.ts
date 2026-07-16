import { mockBookings, mockCoaches, mockPackages, mockSlots } from '@tpa/mocks';
import type { Coach, IsoInstant, Package, PlayerId, SessionSlot } from '@tpa/types';

/**
 * Schedule / catalog selectors over @tpa/mocks. Pure; S9 swaps the bodies for
 * real queries. Screens render dates/money via @tpa/core.
 */

export interface NextSession {
  slot: SessionSlot;
  coach: Coach | undefined;
}

/** The player's soonest upcoming booked session, joined to its coach. */
export function nextSession(playerId: PlayerId, now: IsoInstant): NextSession | null {
  const nowMs = new Date(now).getTime();
  const slotById = new Map(mockSlots.map((s) => [s.id, s]));

  const upcoming = mockBookings
    .filter((b) => b.playerId === playerId && b.status === 'booked')
    .map((b) => slotById.get(b.slotId))
    .filter((s): s is SessionSlot => !!s && new Date(s.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const slot = upcoming[0];
  if (!slot) return null;
  return { slot, coach: mockCoaches.find((c) => c.id === slot.coachId) };
}

/** Active purchasable packages (for the Home top-up scroll). */
export function topUpPackages(): Package[] {
  return mockPackages.filter((p) => p.isActive);
}

/** Per-session unit price in piastres (for "N EGP / session"). */
export function perSessionPiastres(pkg: Package): number {
  return Math.round(pkg.price / pkg.sessionCount);
}
