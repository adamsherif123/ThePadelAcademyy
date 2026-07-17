import { isBatchUsable } from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CoachId,
  IsoInstant,
  Package,
  PackageId,
  Player,
  PlayerId,
  SessionSlot,
  SlotId,
  TrainingType,
} from '@tpa/types';

import {
  getBatches,
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
/** Bookings currently holding a seat on the slot (status 'booked'), earliest first. */
export const activeBookingsForSlot = (slotId: SlotId): Booking[] =>
  getBookings()
    .filter((b) => b.slotId === slotId && b.status === 'booked')
    .sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime());

// Credit
/** Every credit batch a player holds (for the admin add-player verdict). */
export const batchesForPlayer = (playerId: PlayerId) =>
  getBatches().filter((b) => b.playerId === playerId);

/** Usable (unexpired, non-zero, type-matched) credits a player holds for a type. */
export const usableCreditFor = (
  playerId: PlayerId,
  trainingType: TrainingType,
  now: IsoInstant,
): number =>
  getBatches()
    .filter((b) => b.playerId === playerId && isBatchUsable(b, trainingType, now))
    .reduce((sum, b) => sum + b.quantityRemaining, 0);

// Packages
export const allPackages = (): Package[] => getPackages();
export const packageById = (id: PackageId): Package | undefined =>
  getPackages().find((p) => p.id === id);
