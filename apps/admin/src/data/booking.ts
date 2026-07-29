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
 * The admin's booking seams. classifyAdminBooking is the PURE preview over
 * @tpa/core's canBookSlot (used by the add-player picker); the two writes are
 * the atomic RPCs (admin_book_player / remove_booking), which re-run the same
 * rule server-side. The RPC is the enforcement; if the preview and it
 * disagree, the RPC's reason wins.
 *
 * There is no more override-able hard block: level_mismatch was removed first
 * (rule 4 — display-only, never blocking), and gender_mismatch is gone too
 * now (the gender-display-only migration extends rule 4 to gender) — every
 * `canBookSlot` rejection left is a genuine hard block (capacity, credit,
 * status/timing, type), none of which admin_book_player's `p_override` was
 * ever meant to waive (it only ever waived gender). The `kind: 'override'`
 * verdict and its "Book anyway" UI are gone with it — see SlotModal.tsx.
 *
 * `chosenType` mirrors the player app's picker: the slot's own type if it's
 * already fixed, or the admin's pick for an OPEN block (rule 2 applies to a
 * WhatsApp-reported booking exactly as it does to a self-service one — the
 * admin can only pick a type the PLAYER holds a usable credit for).
 */

// --- Add-player classification: a thin preview over canBookSlot (pure) ---
export type AdminBookVerdict =
  | { kind: 'ok'; creditBatchId: CreditBatch['id']; trainingType: TrainingType }
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
  return { kind: 'blocked', reason: raw.reason };
}

/** Does the player already hold a NON-CANCELLED booking on this slot? (Pure.) */
export function isActivelyBooked(bookings: Booking[], slotId: SlotId, playerId: PlayerId): boolean {
  return bookings.some((b) => b.slotId === slotId && b.playerId === playerId && b.status !== 'cancelled');
}

/**
 * Admin books a player into a slot (a WhatsApp booking recorded here) via the
 * atomic admin_book_player RPC. `override` is threaded straight to the RPC's
 * `p_override` parameter, which the RPC still accepts (unchanged signature)
 * but which no longer has anything to waive (gender/level never block) — this
 * app never passes `true` for it anymore (see classifyAdminBooking / SlotModal).
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
