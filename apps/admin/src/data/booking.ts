import { ID_PREFIXES, canBookSlot, newId, type BookBlockReason } from '@tpa/core';
import type {
  Booking,
  BookingId,
  CreditBatch,
  IsoInstant,
  Player,
  PlayerId,
  SessionSlot,
  SlotId,
} from '@tpa/types';

import {
  commitAdminBooking,
  commitBookingRemoval,
  getBatches,
  getBookings,
  getPlayers,
  getSlots,
} from './store';

/**
 * The admin's booking seams — add a player to a session (an admin-initiated
 * bookSlot) and remove one (a cancelSession scoped to a single booking). Both
 * reuse @tpa/core's RULE (canBookSlot) and mirror the client's mechanics; S10
 * replaces the bodies with atomic DB RPCs.
 */

// --- Add-player classification: the admin OVERRIDE POLICY over canBookSlot ---
export type AdminBookVerdict =
  | { kind: 'ok'; creditBatchId: CreditBatch['id'] }
  | { kind: 'override'; reason: 'gender_mismatch' | 'level_mismatch'; creditBatchId: CreditBatch['id'] }
  | { kind: 'blocked'; reason: BookBlockReason | 'already_booked' };

/**
 * Classify whether the admin may add `player` to `slot`, and how. The RULE is
 * canBookSlot (never reimplemented); the POLICY layered on top is which failures
 * the owner may override:
 *  - gender/level mismatch → OVERRIDABLE (the profile filter is a player-facing
 *    convenience; the owner has context). Re-checked with a profile that matches
 *    the slot so the OTHER rules (full, credit) still run — a hard block hiding
 *    behind the mismatch still wins.
 *  - full / already-booked / no usable credit (or expired) / past / cancelled →
 *    HARD blocks. Full is raised via the capacity field, deliberately; the rest
 *    protect the credit ledger and the UNIQUE(player, slot) constraint.
 * Pure — used by both the picker (preview) and the seam (re-validation).
 */
export function classifyAdminBooking(
  slot: SessionSlot,
  player: Player,
  batches: readonly CreditBatch[],
  now: IsoInstant,
  alreadyBooked: boolean,
): AdminBookVerdict {
  if (alreadyBooked) return { kind: 'blocked', reason: 'already_booked' };
  const raw = canBookSlot(slot, player, batches, now);
  if (raw.ok) return { kind: 'ok', creditBatchId: raw.creditBatchId };
  if (raw.reason === 'gender_mismatch' || raw.reason === 'level_mismatch') {
    const override = canBookSlot(
      slot,
      { ...player, gender: slot.gender ?? player.gender, level: slot.level ?? player.level },
      batches,
      now,
    );
    if (override.ok) return { kind: 'override', reason: raw.reason, creditBatchId: override.creditBatchId };
    return { kind: 'blocked', reason: override.reason };
  }
  return { kind: 'blocked', reason: raw.reason };
}

/** Does the player already hold an ACTIVE booking on this slot? (UNIQUE guard.) */
export function isActivelyBooked(slotId: SlotId, playerId: PlayerId): boolean {
  return getBookings().some(
    (b) => b.slotId === slotId && b.playerId === playerId && b.status === 'booked',
  );
}

export type AddPlayerResult =
  | { ok: true; booking: Booking; overridden: boolean }
  | { ok: false; reason: BookBlockReason | 'already_booked' | 'slot_missing' | 'player_missing' };

/**
 * Admin books a player into a slot on their behalf (a WhatsApp booking recorded
 * here). Spends the batch canBookSlot NAMES (earliest-expiring — never chosen
 * here), records creditBatchId on the booking (S3e's refund depends on it), takes
 * a seat, and re-validates. Gender/level are overridable; everything else blocks.
 */
export function addPlayerToSlot(slotId: SlotId, playerId: PlayerId, now: IsoInstant): AddPlayerResult {
  const slot = getSlots().find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };
  const player = getPlayers().find((p) => p.id === playerId);
  if (!player) return { ok: false, reason: 'player_missing' };

  const batches = getBatches().filter((b) => b.playerId === playerId);
  const verdict = classifyAdminBooking(slot, player, batches, now, isActivelyBooked(slotId, playerId));
  if (verdict.kind === 'blocked') return { ok: false, reason: verdict.reason };

  const batch = batches.find((b) => b.id === verdict.creditBatchId);
  if (!batch) return { ok: false, reason: 'no_usable_credit' };

  const updatedBatch: CreditBatch = { ...batch, quantityRemaining: batch.quantityRemaining - 1 };
  const updatedSlot: SessionSlot = { ...slot, bookedCount: slot.bookedCount + 1 };
  const booking: Booking = {
    id: newId(ID_PREFIXES.booking) as BookingId,
    slotId,
    playerId,
    creditBatchId: batch.id,
    status: 'booked',
    bookedAt: now,
    cancelledAt: null,
  };
  commitAdminBooking(booking, updatedBatch, updatedSlot);
  return { ok: true, booking, overridden: verdict.kind === 'override' };
}

// --- Remove-player seam (cancelSession scoped to one booking) ---
export type RemoveBookingResult =
  | { ok: true; refunded: boolean; batch: CreditBatch | null }
  | { ok: false; reason: 'booking_missing' | 'already_cancelled' };

/**
 * Remove ONE player from a session. The academy chooses refund vs forfeit
 * EXPLICITLY (the UI defaults to refund; this seam only does what it's told, so
 * it can't silently become a way around the player's 3-hour rule — an hour-before
 * bail can be a forfeit). The seat is freed either way; on refund the credit goes
 * to the ORIGINAL batch with its ORIGINAL expiry (incremented even if expired —
 * ledger truth; isBatchUsable rejects it). Idempotent: only an active booking is
 * removable, so a re-remove can't double-refund.
 */
export function removeBooking(bookingId: BookingId, now: IsoInstant, refund: boolean): RemoveBookingResult {
  const booking = getBookings().find((b) => b.id === bookingId);
  if (!booking) return { ok: false, reason: 'booking_missing' };
  if (booking.status !== 'booked') return { ok: false, reason: 'already_cancelled' };

  const slot = getSlots().find((s) => s.id === booking.slotId);
  if (!slot) return { ok: false, reason: 'booking_missing' };

  const cancelledBooking: Booking = { ...booking, status: 'cancelled', cancelledAt: now };
  const updatedSlot: SessionSlot = { ...slot, bookedCount: Math.max(0, slot.bookedCount - 1) };

  let updatedBatch: CreditBatch | null = null;
  if (refund) {
    const batch = getBatches().find((b) => b.id === booking.creditBatchId);
    if (batch) updatedBatch = { ...batch, quantityRemaining: batch.quantityRemaining + 1 };
  }

  commitBookingRemoval(cancelledBooking, updatedSlot, updatedBatch ?? undefined);
  return { ok: true, refunded: updatedBatch !== null, batch: updatedBatch };
}
