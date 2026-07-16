import {
  ID_PREFIXES,
  cairoCalendarDate,
  canBookSlot,
  creditExpiryState,
  newId,
  type BookBlockReason,
} from '@tpa/core';
import { mockCoaches, mockTemplates } from '@tpa/mocks';
import type {
  Booking,
  BookingId,
  Coach,
  CreditBatch,
  CreditBatchId,
  IsoInstant,
  Player,
  SessionSlot,
  SlotId,
  TrainingType,
  Weekday,
} from '@tpa/types';

import { commitBooking, getBatches, getBookings, getSlots } from './store';
import { balanceByType } from './wallet';

/**
 * Booking selectors over @tpa/mocks + the store. Availability rules are NOT
 * reimplemented here — the per-slot verdict calls @tpa/core's canBookSlot (the
 * client-side preview of the S7 RPC). Pure; S9 swaps the bodies for Supabase
 * queries with the same shapes. Batches come from the store so a fresh purchase
 * updates Book's credit counts and bookability.
 */

export interface CairoDay {
  year: number;
  month: number;
  day: number;
  weekday: Weekday;
}

function sameCairoDay(instant: IsoInstant, d: CairoDay): boolean {
  const c = cairoCalendarDate(instant);
  return c.year === d.year && c.month === d.month && c.day === d.day;
}

/**
 * The weekdays the academy operates — DERIVED from availability templates, not a
 * constant. A weekday with no active template from any coach is closed, so if the
 * academy adds (say) Thursday availability later, the Book UI opens it up with no
 * code change.
 */
export function operatingWeekdays(): Set<Weekday> {
  return new Set(mockTemplates.filter((t) => t.isActive).map((t) => t.weekday));
}

export function isClosedWeekday(weekday: Weekday): boolean {
  return !operatingWeekdays().has(weekday);
}

export interface DateStripDay extends CairoDay {
  key: string;
  closed: boolean;
}

/** `count` consecutive Cairo days starting today, each flagged open/closed. */
export function dateStrip(now: IsoInstant, count: number): DateStripDay[] {
  const start = cairoCalendarDate(now);
  const base = Date.UTC(start.year, start.month - 1, start.day);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base + i * 86_400_000);
    const weekday = d.getUTCDay() as Weekday;
    const day: CairoDay = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      weekday,
    };
    return { ...day, key: `${day.year}-${day.month}-${day.day}`, closed: isClosedWeekday(weekday) };
  });
}

/**
 * Published slots of `trainingType` on `day`, sorted by start. Group slots are
 * matched to the player's profile (gender AND level — men/ladies train separately
 * and players are placed by level); duo/individual/trial don't filter.
 */
export function slotsForType(
  trainingType: TrainingType,
  player: Player,
  day: CairoDay,
): SessionSlot[] {
  return getSlots()
    .filter((s) => s.status === 'published' && s.trainingType === trainingType)
    .filter((s) => sameCairoDay(s.startsAt, day))
    .filter((s) => trainingType !== 'group' || (s.gender === player.gender && s.level === player.level))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** Slot ids the player currently has an active (`booked`) booking for. */
export function bookedSlotIds(playerId: Player['id']): Set<SlotId> {
  return new Set(
    getBookings().filter((b) => b.playerId === playerId && b.status === 'booked').map((b) => b.slotId),
  );
}

export function coachById(id: Coach['id']): Coach | undefined {
  return mockCoaches.find((c) => c.id === id);
}

export function slotById(id: SlotId): SessionSlot | undefined {
  return getSlots().find((s) => s.id === id);
}

/**
 * Everything the confirm screen needs for one slot: the slot + coach, the
 * canBookSlot verdict (so the screen can guard if it went unbookable), the batch
 * that WILL be spent (chosen by core, not here), and the current usable balance
 * of that type (to show "N left after booking" = balance − 1).
 */
export interface BookingPreview {
  slot: SessionSlot;
  coach: Coach | undefined;
  verdict: ReturnType<typeof canBookSlot>;
  batch: CreditBatch | undefined;
  typeBalance: number;
  alreadyBooked: boolean;
}

export function bookingPreview(
  player: Player,
  slotId: SlotId,
  now: IsoInstant,
): BookingPreview | null {
  const slot = slotById(slotId);
  if (!slot) return null;
  const batches = getBatches().filter((b) => b.playerId === player.id);
  const verdict = canBookSlot(slot, player, batches, now);
  const batch = verdict.ok ? batches.find((b) => b.id === verdict.creditBatchId) : undefined;
  return {
    slot,
    coach: coachById(slot.coachId),
    verdict,
    batch,
    typeBalance: balanceByType(player.id, now)[slot.trainingType],
    alreadyBooked: bookedSlotIds(player.id).has(slotId),
  };
}

/**
 * Why a slot can or can't be booked, for the current player, right now. Wraps
 * canBookSlot and adds two UI-only distinctions core doesn't make: `booked`
 * (the player already holds this slot) and `credits_expired` vs `no_credit`
 * (had credits of this type but they lapsed, vs never had any).
 */
export type SlotAvailability =
  | { kind: 'bookable'; creditBatchId: CreditBatchId }
  | { kind: 'booked' }
  | { kind: 'full' }
  | { kind: 'gender_mismatch' }
  | { kind: 'level_mismatch' }
  | { kind: 'no_credit' }
  | { kind: 'credits_expired' }
  | { kind: 'past' }
  | { kind: 'cancelled' };

export function slotAvailability(
  slot: SessionSlot,
  player: Player,
  now: IsoInstant,
): SlotAvailability {
  if (bookedSlotIds(player.id).has(slot.id)) return { kind: 'booked' };

  const batches = getBatches().filter((b) => b.playerId === player.id);
  const res = canBookSlot(slot, player, batches, now);
  if (res.ok) return { kind: 'bookable', creditBatchId: res.creditBatchId };

  switch (res.reason) {
    case 'slot_full':
      return { kind: 'full' };
    case 'gender_mismatch':
      return { kind: 'gender_mismatch' };
    case 'level_mismatch':
      return { kind: 'level_mismatch' };
    case 'slot_in_past':
      return { kind: 'past' };
    case 'slot_cancelled':
      return { kind: 'cancelled' };
    case 'no_usable_credit': {
      const lapsed = batches
        .filter((b) => b.trainingType === slot.trainingType)
        .some((b) => b.quantityRemaining > 0 && creditExpiryState(b.expiresAt, now) === 'expired');
      return { kind: lapsed ? 'credits_expired' : 'no_credit' };
    }
  }
}

/**
 * THE BOOKING SEAM. The credit-spend mutation, mirroring payForPackage.
 *
 * Re-validates through @tpa/core's canBookSlot and REJECTS anything it says isn't
 * ok — the mutation never trusts the caller. Batch selection is NOT decided here:
 * canBookSlot returns the exact creditBatchId to spend (S1 verified it's the
 * earliest-expiring usable batch). On success it decrements that batch, takes a
 * seat on the slot, and creates a Booking recording the spent batch (S3e refunds
 * to that batch, with its original expiry), then commits all three atomically.
 *
 * MOCK (S3d): commits to the local store. S7 replaces THIS BODY with a single
 * atomic DB RPC that enforces capacity (can't oversell) and credit (can't double-
 * spend) under real concurrency. Screens call bookSlot and route to booked-success
 * on ok; nothing above this function changes.
 */
export type BookResult =
  | { ok: true; booking: Booking; batch: CreditBatch }
  | { ok: false; reason: BookBlockReason | 'slot_missing' | 'already_booked' };

export function bookSlot(player: Player, slotId: SlotId, now: IsoInstant): BookResult {
  const slot = getSlots().find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };

  // Uniqueness guard — a player can't hold two bookings for one slot (canBookSlot
  // is about capacity/credits/profile and doesn't see existing bookings; in S7
  // this is a DB unique constraint on (player, slot)).
  if (bookedSlotIds(player.id).has(slotId)) return { ok: false, reason: 'already_booked' };

  const batches = getBatches().filter((b) => b.playerId === player.id);
  const verdict = canBookSlot(slot, player, batches, now);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  // canBookSlot chose the batch; we only spend the one it named.
  const batch = batches.find((b) => b.id === verdict.creditBatchId);
  if (!batch) return { ok: false, reason: 'no_usable_credit' };

  const updatedBatch: CreditBatch = { ...batch, quantityRemaining: batch.quantityRemaining - 1 };
  const updatedSlot: SessionSlot = { ...slot, bookedCount: slot.bookedCount + 1 };
  const booking: Booking = {
    id: newId(ID_PREFIXES.booking) as BookingId,
    slotId: slot.id,
    playerId: player.id,
    creditBatchId: batch.id, // exact batch spent — S3e refunds here
    status: 'booked',
    bookedAt: now,
    cancelledAt: null,
  };

  commitBooking(booking, updatedBatch, updatedSlot);
  return { ok: true, booking, batch: updatedBatch };
}
