import { TRAINING_TYPES, creditExpiryState, isBatchUsable, parseInstant } from '@tpa/core';
import type { CreditBatch, CreditRequest, IsoInstant, LocationId, TrainingType } from '@tpa/types';

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
/**
 * The batches spendable at ONE branch.
 *
 * Home's "ready to book" number answers "can I book something here, now", so it
 * has to be branch-scoped: a total that includes credits usable only across town
 * would send a player to a session they cannot pay for. The wallet is the
 * opposite — it shows everything, grouped, because that screen is the ledger.
 * `null` means the branch hasn't resolved yet; nothing is spendable until it has.
 */
export function batchesAtLocation(
  batches: readonly CreditBatch[],
  locationId: LocationId | null,
): CreditBatch[] {
  if (locationId === null) return [];
  return batches.filter((b) => b.locationId === locationId);
}

/**
 * The distinct branches where the player has credits they can actually spend.
 *
 * The question "is this player's wallet split across branches at all" — which is
 * the only condition under which a per-branch breakdown tells them anything. A
 * player with everything in one place does not need to be told which place on a
 * screen that already shows one number, and one standing at a branch where they
 * hold nothing is better served by the empty state than by "0 usable here".
 *
 * Usable, not merely owned: a spent or expired batch is history, and history at
 * a second branch does not make a wallet split.
 */
export function locationsWithCredits(
  batches: readonly CreditBatch[],
  now: IsoInstant,
): LocationId[] {
  const ids = new Set<LocationId>();
  for (const b of activeBatches([...batches], now)) {
    if (b.locationId !== null) ids.add(b.locationId);
  }
  return [...ids];
}

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

// ── the credit-request notice on the wallet ──────────────────────────────────

/**
 * How long a DECLINED request keeps its notice on the wallet.
 *
 * A decline is news, and news goes stale. The card used to sit there until the
 * player happened to submit another request — which, for a player who reads the
 * reason and decides not to bother, is forever: a permanent red banner about
 * something they already dealt with. A day is long enough that nobody misses the
 * message and short enough that it stops being furniture.
 */
export const DECLINED_NOTICE_HOURS = 24;

/**
 * The credit request the wallet should tell the player about, if any.
 *
 * A PENDING request always wins: it is live, the player is waiting on it, and it
 * has no expiry — it stays until the academy resolves it.
 *
 * Otherwise the most recent request, and only while a decline is still recent.
 * Approved requests get no card at all; their credits are in the batches below,
 * which is a better answer than a notice saying they arrived.
 *
 * `requests` is expected newest-first (fetchMyCreditRequests orders by
 * created_at desc), which is why only the head is considered for the rejected
 * case: an older decline behind a newer request is not the latest news.
 */
export function openCreditRequest(
  requests: readonly CreditRequest[],
  now: IsoInstant,
): CreditRequest | undefined {
  const pending = requests.find((r) => r.status === 'pending');
  if (pending) return pending;

  const latest = requests[0];
  if (latest?.status !== 'rejected') return undefined;
  // resolvedAt is NOT NULL for a rejected row (credit_requests_resolution_shape),
  // so the fallback is defence only. createdAt is never later than resolution, so
  // the worst it can do is retire the notice early — the safe direction for a
  // message whose failure mode is overstaying.
  const declinedAt = latest.resolvedAt ?? latest.createdAt;
  const hours = (parseInstant(now).getTime() - parseInstant(declinedAt).getTime()) / 3_600_000;
  return hours < DECLINED_NOTICE_HOURS ? latest : undefined;
}
