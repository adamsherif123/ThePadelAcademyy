import type {
  CreditBatch,
  Gender,
  IsoInstant,
  Level,
  Player,
  SessionSlot,
  TrainingType,
} from '@tpa/types';

import { CANCELLATION_WINDOW_HOURS } from './constants';
import { parseInstant, toInstant } from './time';

/**
 * Pure, side-effect-free previews of the booking rules. They take `now` as a
 * parameter (never read the clock) so they are deterministic and testable. These
 * are the CLIENT-SIDE preview only; the authoritative enforcement is the DB/RPC
 * layer in S7. Keeping the logic here means the app can grey out a button before
 * a round-trip, but it is never the source of truth.
 */

/** A group slot carries a required gender + level; other formats never do. */
export function isGroupSlot(
  slot: SessionSlot,
): slot is SessionSlot & { gender: Gender; level: Level } {
  return slot.trainingType === 'group';
}

/** Seats left on a slot. A cancelled slot has none. Never negative. */
export function slotRemainingCapacity(slot: SessionSlot): number {
  if (slot.status !== 'published') return 0;
  return Math.max(0, slot.capacity - slot.bookedCount);
}

/**
 * Is the session confirmed (it's on)? The single rule both apps read. STICKY and
 * RECORDED: it's `confirmedAt !== null`, NOT `booked_count >= capacity` — a session
 * that filled then lost a player stays confirmed (see SessionSlot.confirmedAt). A
 * session is confirmed when it fills (the booking that reaches capacity stamps it)
 * or when the admin confirms it manually; until then it's pending.
 */
export function isSessionConfirmed(slot: SessionSlot): boolean {
  return slot.confirmedAt !== null;
}

/**
 * How many more bookings would fill a PENDING session (and so auto-confirm it).
 * Zero once confirmed. Used for the honest "runs once N more players join" copy —
 * a statement of what fills it, never a promise of notification.
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

export type BookBlockReason =
  | 'slot_cancelled'
  | 'slot_in_past'
  | 'slot_full'
  | 'gender_mismatch'
  | 'level_mismatch'
  | 'no_usable_credit';

export type CanBookResult =
  | { ok: true; creditBatchId: CreditBatch['id'] }
  | { ok: false; reason: BookBlockReason };

/**
 * Whether `player` could book `slot` given their `creditBatches` at time `now`.
 * On success, names the batch that would pay — the earliest-expiring usable one,
 * so credits are consumed before they lapse. Returns a reason on failure so the
 * UI can explain why a slot isn't bookable.
 *
 * Not a boolean by design: the client needs the reason and the chosen batch.
 */
export function canBookSlot(
  slot: SessionSlot,
  player: Player,
  creditBatches: readonly CreditBatch[],
  now: IsoInstant,
): CanBookResult {
  if (slot.status !== 'published') return { ok: false, reason: 'slot_cancelled' };
  if (parseInstant(slot.startsAt).getTime() <= parseInstant(now).getTime()) {
    return { ok: false, reason: 'slot_in_past' };
  }
  if (slotRemainingCapacity(slot) <= 0) return { ok: false, reason: 'slot_full' };
  if (slot.gender !== null && slot.gender !== player.gender) {
    return { ok: false, reason: 'gender_mismatch' };
  }
  if (slot.level !== null && slot.level !== player.level) {
    return { ok: false, reason: 'level_mismatch' };
  }

  const usable = creditBatches
    .filter((batch) => batch.playerId === player.id && isBatchUsable(batch, slot.trainingType, now))
    .sort((a, b) => parseInstant(a.expiresAt).getTime() - parseInstant(b.expiresAt).getTime());

  const batch = usable[0];
  if (!batch) return { ok: false, reason: 'no_usable_credit' };
  return { ok: true, creditBatchId: batch.id };
}
