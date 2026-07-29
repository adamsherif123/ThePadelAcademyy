import type {
  CreditBatch,
  Gender,
  IsoInstant,
  Level,
  Player,
  SessionSlot,
  TrainingType,
} from '@tpa/types';

import { CANCELLATION_WINDOW_HOURS, TRAINING_TYPES } from './constants';
import { parseInstant, toInstant } from './time';

/**
 * Pure, side-effect-free previews of the booking rules. They take `now` as a
 * parameter (never read the clock) so they are deterministic and testable. These
 * are the CLIENT-SIDE preview only; the authoritative enforcement is the DB/RPC
 * layer in S7/the booking rework (book_slot / admin_book_player). Keeping the
 * logic here means the app can grey out a button before a round-trip, but it is
 * never the source of truth.
 */

/**
 * A group slot carries a required level; other formats — including an OPEN
 * (untyped) slot, which is neither `null !== 'group'` nor any other format
 * until its first booking fixes it — never do. `slot.trainingType === 'group'` is
 * already null-safe (`null === 'group'` is simply `false`), so an open slot
 * correctly narrows to `false` here with no special-casing. Gender is NOT
 * required even for group (the gender-display-only migration) — a group slot
 * may legitimately have `gender: null` (mixed, no restriction), so the
 * narrowed type below reflects that (`gender: Gender | null`, not `Gender`).
 */
export function isGroupSlot(
  slot: SessionSlot,
): slot is SessionSlot & { trainingType: 'group'; gender: Gender | null; level: Level } {
  return slot.trainingType === 'group';
}

/** Seats left on a slot. A cancelled slot has none. Never negative. */
export function slotRemainingCapacity(slot: SessionSlot): number {
  if (slot.status !== 'published') return 0;
  return Math.max(0, slot.capacity - slot.bookedCount);
}

/**
 * Is the session confirmed (it's on)? The single rule both apps read (S11.1):
 *
 *   confirmed  ⇔  booked_count >= capacity  OR  manuallyConfirmedAt !== null
 *
 * Fill-confirmation is DERIVED — a duo at 1/2 is not confirmed, and a 4/4 that
 * un-fills to 3/4 drops back to pending (it literally isn't full). Manual
 * confirmation is STICKY — once the admin confirms, it stays confirmed through an
 * un-fill, because that's her recorded decision, not something the count implies.
 * (A capacity-1 session is confirmed on its first booking, always.)
 */
export function isSessionConfirmed(slot: SessionSlot): boolean {
  return slot.bookedCount >= slot.capacity || slot.manuallyConfirmedAt !== null;
}

/**
 * How many more bookings would fill a PENDING session (and so confirm it). Zero once
 * confirmed. Used for the honest "runs once N more players join" copy — a statement
 * of what fills it, never a promise of notification.
 */
export function spotsUntilConfirmed(slot: SessionSlot): number {
  if (isSessionConfirmed(slot)) return 0;
  return Math.max(0, slot.capacity - slot.bookedCount);
}

/**
 * Can this credit batch pay for a slot of `trainingType` right now? Credits are
 * typed (a group credit can't book an individual slot), must have quantity left,
 * and must not have expired.
 */
export function isBatchUsable(
  batch: CreditBatch,
  trainingType: TrainingType,
  now: IsoInstant,
): boolean {
  if (batch.trainingType !== trainingType) return false;
  if (batch.quantityRemaining <= 0) return false;
  return parseInstant(batch.expiresAt).getTime() > parseInstant(now).getTime();
}

/**
 * Is the slot far enough in the future to cancel without forfeiting the credit?
 * True only while more than CANCELLATION_WINDOW_HOURS remain before it starts.
 */
export function isCancellableWithoutForfeit(slot: SessionSlot, now: IsoInstant): boolean {
  if (slot.status !== 'published') return false;
  const msUntilStart = parseInstant(slot.startsAt).getTime() - parseInstant(now).getTime();
  return msUntilStart > CANCELLATION_WINDOW_HOURS * 3_600_000;
}

/**
 * The instant up to which a slot can be cancelled for a full refund —
 * CANCELLATION_WINDOW_HOURS before it starts. The one place the deadline is
 * computed; screens render it via format.ts (e.g. "Free cancellation until …")
 * rather than doing startsAt − 3h themselves.
 */
export function cancellationDeadline(slot: SessionSlot): IsoInstant {
  return toInstant(new Date(parseInstant(slot.startsAt).getTime() - CANCELLATION_WINDOW_HOURS * 3_600_000));
}

/**
 * `level_mismatch` is GONE (the booking rework, rule 4): level is display-only —
 * an intermediate player sees "Beginner" on a group slot and self-selects out,
 * but no code, client or server, blocks the join. `gender_mismatch` is ALSO
 * GONE now (the gender-display-only migration extends rule 4 to gender): a
 * men player sees "Ladies'" on a group slot and self-selects out same as
 * level, but no code blocks the join either. Both fields are still recorded
 * on the slot and shown — neither gates anymore.
 *
 * `type_mismatch` is NEW: on an OPEN slot, two players can race to fix its type
 * (see `bookableTypesFor`); the loser's client may still think a since-resolved
 * slot is open, or a stale render may offer a type someone else's booking has
 * already ruled out. It's also what a genuinely wrong `chosenType` against an
 * ALREADY-typed slot resolves to. Mirrors the RPC's own `type_mismatch` reason
 * exactly — see book_slot in the booking-rework migrations.
 */
export type BookBlockReason =
  | 'slot_cancelled'
  | 'slot_in_past'
  | 'slot_full'
  | 'type_mismatch'
  | 'no_usable_credit';

export type CanBookResult =
  | { ok: true; creditBatchId: CreditBatch['id']; trainingType: TrainingType }
  | { ok: false; reason: BookBlockReason };

/**
 * Whether `player` could book `slot` AS `chosenType`, given their `creditBatches`
 * at time `now`. `chosenType` is mandatory — on an ALREADY-typed slot the caller
 * just passes `slot.trainingType` (the type isn't theirs to choose, but stating
 * it lets this function mirror the RPC's own type_mismatch check uniformly); on
 * an OPEN slot it's the player's actual pick from the type picker. On success,
 * the result also names the RESOLVED type (== slot.trainingType if it was
 * already set, else `chosenType`) — callers that don't know whether a slot was
 * open going in (bookingPreview, the wallet-balance line after booking) can read
 * it off the result instead of re-deriving `slot.trainingType ?? chosenType`
 * themselves — and the batch that would pay: the earliest-expiring usable one,
 * so credits are consumed before they lapse. Returns a reason on failure so the
 * UI can explain why a slot isn't bookable.
 *
 * Not a boolean by design: the client needs the reason, the resolved type, and
 * the chosen batch.
 */
export function canBookSlot(
  slot: SessionSlot,
  player: Player,
  creditBatches: readonly CreditBatch[],
  now: IsoInstant,
  chosenType: TrainingType,
): CanBookResult {
  if (slot.status !== 'published') return { ok: false, reason: 'slot_cancelled' };
  if (parseInstant(slot.startsAt).getTime() <= parseInstant(now).getTime()) {
    return { ok: false, reason: 'slot_in_past' };
  }
  if (slotRemainingCapacity(slot) <= 0) return { ok: false, reason: 'slot_full' };
  // gender and level are both display-only (rule 4, extended to gender) —
  // neither blocks, neither is checked anywhere in this function.

  if (slot.trainingType !== null && slot.trainingType !== chosenType) {
    return { ok: false, reason: 'type_mismatch' };
  }
  const trainingType = slot.trainingType ?? chosenType;

  const usable = creditBatches
    .filter((batch) => batch.playerId === player.id && isBatchUsable(batch, trainingType, now))
    .sort((a, b) => parseInstant(a.expiresAt).getTime() - parseInstant(b.expiresAt).getTime());

  const batch = usable[0];
  if (!batch) return { ok: false, reason: 'no_usable_credit' };
  return { ok: true, creditBatchId: batch.id, trainingType };
}

/** One type a player could create/join on a slot right now, with what the picker needs to show it. */
export interface BookableType {
  trainingType: TrainingType;
  creditBatchId: CreditBatch['id'];
  /** Sum of usable (unexpired, non-zero) quantityRemaining across every batch of this type. */
  creditsAvailable: number;
}

/**
 * Every type `player` could create or join on `slot` right now — the ONE
 * function the type picker, the schedule's browse-by-type list, and the
 * block-tap flow all consume, so "what can they afford here" is never derived
 * twice and can never disagree with what `canBookSlot` itself would decide for
 * that type. Built directly ON canBookSlot (tries every candidate type through
 * it), not a parallel reimplementation — that's what the SQL↔TS parity
 * discipline requires here: one place resolves a chosen type against a slot.
 *
 * A TYPED slot has exactly one candidate (its own type) and so yields at most
 * one entry. An OPEN slot tries all four `TrainingType`s — gender is no longer
 * checked inside canBookSlot at all (display-only, like level), so it never
 * filters anything out here or anywhere downstream.
 */
export function bookableTypesFor(
  slot: SessionSlot,
  player: Player,
  creditBatches: readonly CreditBatch[],
  now: IsoInstant,
): readonly BookableType[] {
  const candidates: readonly TrainingType[] = slot.trainingType !== null ? [slot.trainingType] : TRAINING_TYPES;
  const results: BookableType[] = [];
  for (const trainingType of candidates) {
    const verdict = canBookSlot(slot, player, creditBatches, now, trainingType);
    if (!verdict.ok) continue;
    const creditsAvailable = creditBatches
      .filter((batch) => batch.playerId === player.id && isBatchUsable(batch, trainingType, now))
      .reduce((sum, batch) => sum + batch.quantityRemaining, 0);
    results.push({ trainingType, creditBatchId: verdict.creditBatchId, creditsAvailable });
  }
  return results;
}
