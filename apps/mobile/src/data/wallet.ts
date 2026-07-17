import { TRAINING_TYPES, creditExpiryState, isBatchUsable } from '@tpa/core';
import type { CreditBatch, IsoInstant, TrainingType } from '@tpa/types';

/**
 * Wallet selectors — pure functions of a credit-batch list and `now`. The list is
 * the signed-in player's own batches, already scoped to them by RLS at the query
 * (S9); nothing here filters by player. The @tpa/core rules (expiry, usability) are
 * unchanged — only their input moved from a global store to a passed array, so the
 * same logic now runs over live Supabase data. Nothing formats; screens render via
 * @tpa/core.
 */

/** Non-expired batches, soonest-expiry first (the "active batches" list). */
export function activeBatches(batches: CreditBatch[], now: IsoInstant): CreditBatch[] {
  return batches
    .filter((b) => creditExpiryState(b.expiresAt, now) !== 'expired')
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

/** Expired batches, most-recently-expired first. */
export function expiredBatches(batches: CreditBatch[], now: IsoInstant): CreditBatch[] {
  return batches
    .filter((b) => creditExpiryState(b.expiresAt, now) === 'expired')
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());
}

/** Bookable (usable) remaining credits per training type. */
export function balanceByType(batches: CreditBatch[], now: IsoInstant): Record<TrainingType, number> {
  const balance = Object.fromEntries(TRAINING_TYPES.map((t) => [t, 0])) as Record<
    TrainingType,
    number
  >;
  for (const b of batches) {
    if (isBatchUsable(b, b.trainingType, now)) balance[b.trainingType] += b.quantityRemaining;
  }
  return balance;
}

/** Total credits ready to book now. */
export function totalReadyToBook(batches: CreditBatch[], now: IsoInstant): number {
  return Object.values(balanceByType(batches, now)).reduce((sum, n) => sum + n, 0);
}

/** The soonest-expiring usable batch that is in its warning window, if any. */
export function soonestExpiringBatch(batches: CreditBatch[], now: IsoInstant): CreditBatch | null {
  return (
    activeBatches(batches, now).find(
      (b) => isBatchUsable(b, b.trainingType, now) && creditExpiryState(b.expiresAt, now) === 'expiring_soon',
    ) ?? null
  );
}
