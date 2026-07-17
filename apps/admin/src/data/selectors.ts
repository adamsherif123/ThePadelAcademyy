import { isBatchUsable } from '@tpa/core';
import type {
  Booking,
  Coach,
  CoachId,
  CreditBatch,
  IsoInstant,
  Package,
  PackageId,
  Player,
  PlayerId,
  SessionSlot,
  SlotId,
  TrainingType,
} from '@tpa/types';

/**
 * Basic admin lookups — pure functions of the fetched rows. S10b killed the store,
 * so each takes the array it reads instead of calling a store getter; the logic is
 * unchanged. Nothing here formats — screens render money/dates via @tpa/core.
 */

export const coachById = (coaches: Coach[], id: CoachId): Coach | undefined =>
  coaches.find((c) => c.id === id);

export const playerById = (players: Player[], id: PlayerId): Player | undefined =>
  players.find((p) => p.id === id);

export const slotById = (slots: SessionSlot[], id: SlotId): SessionSlot | undefined =>
  slots.find((s) => s.id === id);

export const packageById = (packages: Package[], id: PackageId): Package | undefined =>
  packages.find((p) => p.id === id);

export const bookingsForSlot = (bookings: Booking[], slotId: SlotId): Booking[] =>
  bookings.filter((b) => b.slotId === slotId);

export const bookingsForPlayer = (bookings: Booking[], playerId: PlayerId): Booking[] =>
  bookings.filter((b) => b.playerId === playerId);

/** Bookings currently holding a seat on the slot (status 'booked'), earliest first. */
export const activeBookingsForSlot = (bookings: Booking[], slotId: SlotId): Booking[] =>
  bookings
    .filter((b) => b.slotId === slotId && b.status === 'booked')
    .sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime());

/** Every credit batch a player holds (for the admin add-player verdict). */
export const batchesForPlayer = (batches: CreditBatch[], playerId: PlayerId): CreditBatch[] =>
  batches.filter((b) => b.playerId === playerId);

/** Usable (unexpired, non-zero, type-matched) credits a player holds for a type. */
export const usableCreditFor = (
  batches: CreditBatch[],
  playerId: PlayerId,
  trainingType: TrainingType,
  now: IsoInstant,
): number =>
  batches
    .filter((b) => b.playerId === playerId && isBatchUsable(b, trainingType, now))
    .reduce((sum, b) => sum + b.quantityRemaining, 0);
