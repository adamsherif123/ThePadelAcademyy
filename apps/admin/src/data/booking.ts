import { canBookSlot, type BookBlockReason } from '@tpa/core';
import type {
  Booking,
  CreditBatch,
  IsoInstant,
  Player,
  PlayerId,
  SessionSlot,
  SlotId,
  TrainingType,
} from '@tpa/types';

import {
  adminBookPlayerRpc,
  removeBookingRpc,
  type AdminBookResult,
  type RemoveBookingResult,
} from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * The admin's booking seams. classifyAdminBooking is the PURE override-policy
 * preview over @tpa/core's canBookSlot (used by the add-player picker); the two
 * writes are the atomic RPCs (admin_book_player / remove_booking), which re-run the
 * same rule server-side. The RPC is the enforcement; if the preview and it disagree,
 * the RPC's reason wins.
 *
 * `chosenType` mirrors the player app's picker: the slot's own type if it's
 * already fixed, or the admin's pick for an OPEN block (rule 2 applies to a
 * WhatsApp-reported booking exactly as it does to a self-service one — the
 * admin can only pick a type the PLAYER holds a usable credit for; override
 * waives gender only, never the credit check).
 */

// --- Add-player classification: the admin OVERRIDE POLICY over canBookSlot (pure) ---
export type AdminBookVerdict =
  | { kind: 'ok'; creditBatchId: CreditBatch['id']; trainingType: TrainingType }
  | { kind: 'override'; reason: 'gender_mismatch'; creditBatchId: CreditBatch['id']; trainingType: TrainingType }
  | { kind: 'blocked'; reason: BookBlockReason | 'already_booked' };

export function classifyAdminBooking(
  slot: SessionSlot,
  player: Player,
  batches: readonly CreditBatch[],
  now: IsoInstant,
  alreadyBooked: boolean,
  chosenType: TrainingType,
): AdminBookVerdict {
  if (alreadyBooked) return { kind: 'blocked', reason: 'already_booked' };
  const raw = canBookSlot(slot, player, batches, now, chosenType);
  if (raw.ok) return { kind: 'ok', creditBatchId: raw.creditBatchId, trainingType: raw.trainingType };
  // level_mismatch is gone (rule 4: display-only, never blocking — no override
  // needed for it). gender_mismatch is the one override-able hard block left.
  if (raw.reason === 'gender_mismatch') {
    const override = canBookSlot(slot, { ...player, gender: slot.gender ?? player.gender }, batches, now, chosenType);
    if (override.ok) {
      return { kind: 'override', reason: 'gender_mismatch', creditBatchId: override.creditBatchId, trainingType: override.trainingType };
    }
    return { kind: 'blocked', reason: override.reason };
  }
  return { kind: 'blocked', reason: raw.reason };
}

/** Does the player already hold a NON-CANCELLED booking on this slot? (Pure.) */
export function isActivelyBooked(bookings: Booking[], slotId: SlotId, playerId: PlayerId): boolean {
  return bookings.some((b) => b.slotId === slotId && b.playerId === playerId && b.status !== 'cancelled');
}

/**
 * Admin books a player into a slot (a WhatsApp booking recorded here) via the atomic
 * admin_book_player RPC. `override` waives a gender mismatch ONLY — every other
 * rule still runs server-side, so a hard block hiding behind a mismatch still wins.
 * `trainingType` is the admin's pick for an OPEN slot; null for an already-typed one.
 */
export function addPlayerToSlot(
  slotId: SlotId,
  playerId: PlayerId,
  override: boolean,
  trainingType: TrainingType | null,
): Promise<AdminBookResult | { ok: false; reason: 'network' }> {
  return runRpc(() => adminBookPlayerRpc(slotId, playerId, override, trainingType), TOUCHED.booking);
}

/** Remove ONE player from a session, refunding or forfeiting, via remove_booking. */
export function removeBooking(
  bookingId: Booking['id'],
  refund: boolean,
): Promise<RemoveBookingResult | { ok: false; reason: 'network' }> {
  return runRpc(() => removeBookingRpc(bookingId, refund), TOUCHED.booking);
}
