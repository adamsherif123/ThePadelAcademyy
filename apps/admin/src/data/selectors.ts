import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CoachId,
  Package,
  PackageId,
  Player,
  PlayerId,
  SessionSlot,
  SlotId,
} from '@tpa/types';

import {
  getBookings,
  getCoaches,
  getPackages,
  getPlayers,
  getSlots,
  getTemplates,
} from './store';

/**
 * Basic admin selectors over the store. Pure reads (no `now` needed yet — the
 * date-relative aggregates are S4b's dashboard); S10 swaps the store internals
 * for Supabase without any selector or screen changing. Nothing here formats —
 * screens render money/dates via @tpa/core.
 */

// Coaches
export const allCoaches = (): Coach[] => getCoaches();
export const activeCoaches = (): Coach[] => getCoaches().filter((c) => c.isActive);
export const coachById = (id: CoachId): Coach | undefined => getCoaches().find((c) => c.id === id);

// Players
export const allPlayers = (): Player[] => getPlayers();
export const playerById = (id: PlayerId): Player | undefined =>
  getPlayers().find((p) => p.id === id);

// Schedule
export const allSlots = (): SessionSlot[] => getSlots();
export const slotById = (id: SlotId): SessionSlot | undefined =>
  getSlots().find((s) => s.id === id);
export const allTemplates = (): AvailabilityTemplate[] => getTemplates();

// Bookings
export const allBookings = (): Booking[] => getBookings();
export const bookingsForSlot = (slotId: SlotId): Booking[] =>
  getBookings().filter((b) => b.slotId === slotId);
export const bookingsForPlayer = (playerId: PlayerId): Booking[] =>
  getBookings().filter((b) => b.playerId === playerId);

// Packages
export const allPackages = (): Package[] => getPackages();
export const activePackages = (): Package[] => getPackages().filter((p) => p.isActive);
export const packageById = (id: PackageId): Package | undefined =>
  getPackages().find((p) => p.id === id);
