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

/**
 * The batches the Wallet lists: ACTIVE ones only — unexpired AND with credits
 * left — soonest-expiry first.
 *
 * "Active" is not a second definition of usability: it IS @tpa/core's
 * isBatchUsable, the same predicate balanceByType sums and book_slot spends
 * through, asked about the batch's own trainingType (a batch is always the
 * right type for itself, so the check reduces to "unexpired and
 * quantityRemaining > 0"). Sharing that one predicate is what keeps this list
 * and the headline/pills above it in agreement BY CONSTRUCTION: a card appears
 * exactly when its credits are part of the balance shown above it — never a
 * card for credits the headline doesn't count.
 *
 * A spent or expired batch is history, not wallet contents, so it isn't listed
 * at all (it remains in the DB — nothing here deletes anything).
 */
export function activeBatches(batches: CreditBatch[], now: IsoInstant): CreditBatch[] {
  return batches
    .filter((b) => isBatchUsable(b, b.trainingType, now))
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
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

/**
 * Which balance pills the Wallet shows, in TRAINING_TYPES order.
 *
 * Group/Duo/Individual always render (dimming at zero — they're the types you can go
 * and buy). TRIAL renders only while one is actually held: it's a once-per-player
 * credit, so for everyone who has used theirs a permanent dimmed "0 Trial" was pure
 * clutter.
 *
 * `balance[t] > 0` is not a new rule — balanceByType only counts a batch passing
 * @tpa/core's isBatchUsable (unexpired AND quantityRemaining > 0), and
 * totalReadyToBook sums those same per-type numbers. So the visible pills ALWAYS
 * tally to the headline: when the trial pill shows it contributes its credit to both,
 * and when it doesn't it contributes 0 to both. Lives here, not in the component, so
 * the invariant is unit-testable (wallet.tally.test.ts).
 */
export function visibleBalanceTypes(balance: Record<TrainingType, number>): TrainingType[] {
  return TRAINING_TYPES.filter((t) => t !== 'trial' || balance[t] > 0);
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
