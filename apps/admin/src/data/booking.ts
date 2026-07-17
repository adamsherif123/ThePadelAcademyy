import { canBookSlot, type BookBlockReason } from '@tpa/core';
import type { Booking, CreditBatch, IsoInstant, Player, PlayerId, SessionSlot, SlotId } from '@tpa/types';

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
 */

// --- Add-player classification: the admin OVERRIDE POLICY over canBookSlot (pure) ---
export type AdminBookVerdict =
  | { kind: 'ok'; creditBatchId: CreditBatch['id'] }
  | { kind: 'override'; reason: 'gender_mismatch' | 'level_mismatch'; creditBatchId: CreditBatch['id'] }
  | { kind: 'blocked'; reason: BookBlockReason | 'already_booked' };

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

/** Does the player already hold a NON-CANCELLED booking on this slot? (Pure.) */
export function isActivelyBooked(bookings: Booking[], slotId: SlotId, playerId: PlayerId): boolean {
  return bookings.some((b) => b.slotId === slotId && b.playerId === playerId && b.status !== 'cancelled');
}

/**
 * Admin books a player into a slot (a WhatsApp booking recorded here) via the atomic
 * admin_book_player RPC. `override` waives gender/level mismatch ONLY — every other
 * rule still runs server-side, so a hard block hiding behind a mismatch still wins.
 */
export function addPlayerToSlot(
  slotId: SlotId,
  playerId: PlayerId,
  override: boolean,
): Promise<AdminBookResult | { ok: false; reason: 'network' }> {
  return runRpc(() => adminBookPlayerRpc(slotId, playerId, override), TOUCHED.booking);
}

/** Remove ONE player from a session, refunding or forfeiting, via remove_booking. */
export function removeBooking(
  bookingId: Booking['id'],
  refund: boolean,
): Promise<RemoveBookingResult | { ok: false; reason: 'network' }> {
  return runRpc(() => removeBookingRpc(bookingId, refund), TOUCHED.booking);
}
