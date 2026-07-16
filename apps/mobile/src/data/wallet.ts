import { TRAINING_TYPES, creditExpiryState, isBatchUsable } from '@tpa/core';
import type { CreditBatch, IsoInstant, PlayerId, TrainingType } from '@tpa/types';

import { getBatches } from './store';

/**
 * Wallet selectors over the data store (seeded from @tpa/mocks, mutated by
 * purchases). Pure functions of (playerId, now) — S9 replaces the store's
 * internals with Supabase without any selector or screen changing. Nothing here
 * formats; screens render via @tpa/core.
 */

function batchesFor(playerId: PlayerId): CreditBatch[] {
  return getBatches().filter((b) => b.playerId === playerId);
}

/** Non-expired batches, soonest-expiry first (the "active batches" list). */
export function activeBatches(playerId: PlayerId, now: IsoInstant): CreditBatch[] {
  return batchesFor(playerId)
    .filter((b) => creditExpiryState(b.expiresAt, now) !== 'expired')
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

/** Expired batches, most-recently-expired first. */
export function expiredBatches(playerId: PlayerId, now: IsoInstant): CreditBatch[] {
  return batchesFor(playerId)
    .filter((b) => creditExpiryState(b.expiresAt, now) === 'expired')
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());
}

/** Bookable (usable) remaining credits per training type. */
export function balanceByType(playerId: PlayerId, now: IsoInstant): Record<TrainingType, number> {
  const balance = Object.fromEntries(TRAINING_TYPES.map((t) => [t, 0])) as Record<
    TrainingType,
    number
  >;
  for (const b of batchesFor(playerId)) {
    if (isBatchUsable(b, b.trainingType, now)) balance[b.trainingType] += b.quantityRemaining;
  }
  return balance;
}

/** Total credits ready to book now. */
export function totalReadyToBook(playerId: PlayerId, now: IsoInstant): number {
  return Object.values(balanceByType(playerId, now)).reduce((sum, n) => sum + n, 0);
}

/** The soonest-expiring usable batch that is in its warning window, if any. */
export function soonestExpiringBatch(playerId: PlayerId, now: IsoInstant): CreditBatch | null {
  return (
    activeBatches(playerId, now).find(
      (b) => isBatchUsable(b, b.trainingType, now) && creditExpiryState(b.expiresAt, now) === 'expiring_soon',
    ) ?? null
  );
}
