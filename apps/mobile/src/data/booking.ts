import {
  ID_PREFIXES,
  cairoCalendarDate,
  canBookSlot,
  cancellationDeadline,
  creditExpiryState,
  isCancellableWithoutForfeit,
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

import { commitBooking, commitCancellation, getBatches, getBookings, getSlots } from './store';
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

/**
 * Slot ids the player holds a NON-CANCELLED booking for (booked / attended /
 * no_show). Only a cancellation frees the seat, so this is exactly the set that
 * blocks a second booking — mirroring the DB's partial unique index
 * `bookings_one_active_per_player_slot WHERE status <> 'cancelled'`. A cancelled
 * booking is excluded, so cancel → re-book the same slot is allowed on both sides.
 */
export function bookedSlotIds(playerId: Player['id']): Set<SlotId> {
  return new Set(
    getBookings().filter((b) => b.playerId === playerId && b.status !== 'cancelled').map((b) => b.slotId),
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

/** A booking paired with its slot and coach, for the Sessions lists. */
export interface SessionEntry {
  booking: Booking;
  slot: SessionSlot;
  coach: Coach | undefined;
}

function sessionEntries(playerId: Player['id']): SessionEntry[] {
  return getBookings()
    .filter((b) => b.playerId === playerId)
    .map((b) => {
      const slot = slotById(b.slotId);
      return slot ? { booking: b, slot, coach: coachById(slot.coachId) } : null;
    })
    .filter((e): e is SessionEntry => e !== null);
}

function hasStarted(slot: SessionSlot, now: IsoInstant): boolean {
  return new Date(slot.startsAt).getTime() <= new Date(now).getTime();
}

/**
 * "Upcoming" is genuine future court time: an ACTIVE (`booked`) booking whose slot
 * has not started yet. The split is by the slot's startsAt, not booking status —
 * EXCEPT that a cancelled booking is never upcoming even if its slot is still in
 * the future (a cancelled seat is a record, not a plan). Soonest first.
 */
export function upcomingSessions(playerId: Player['id'], now: IsoInstant): SessionEntry[] {
  return sessionEntries(playerId)
    .filter((e) => e.booking.status === 'booked' && !hasStarted(e.slot, now))
    .sort((a, b) => new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime());
}

/**
 * "Past" is everything else: sessions whose slot has started (attended / no_show /
 * a booking never cancelled) AND any cancelled booking regardless of slot time.
 * Most recent first.
 */
export function pastSessions(playerId: Player['id'], now: IsoInstant): SessionEntry[] {
  return sessionEntries(playerId)
    .filter((e) => !(e.booking.status === 'booked' && !hasStarted(e.slot, now)))
    .sort((a, b) => new Date(b.slot.startsAt).getTime() - new Date(a.slot.startsAt).getTime());
}

/**
 * Everything the cancel screen needs for one booking: the slot + coach, whether
 * cancelling now refunds (isCancellableWithoutForfeit), the refund deadline, the
 * batch the credit returns to, and whether that batch is ALREADY expired at `now`
 * — so the sheet can promise a refund only when it's actually spendable.
 */
export interface CancelPreview {
  booking: Booking;
  slot: SessionSlot;
  coach: Coach | undefined;
  refundable: boolean;
  deadline: IsoInstant;
  batch: CreditBatch | undefined;
  refundExpired: boolean;
}

export function cancelPreview(
  player: Player,
  bookingId: BookingId,
  now: IsoInstant,
): CancelPreview | null {
  const booking = getBookings().find((b) => b.id === bookingId && b.playerId === player.id);
  if (!booking) return null;
  const slot = slotById(booking.slotId);
  if (!slot) return null;
  const batch = getBatches().find((b) => b.id === booking.creditBatchId);
  const refundable = isCancellableWithoutForfeit(slot, now);
  const refundExpired =
    refundable && batch !== undefined && creditExpiryState(batch.expiresAt, now) === 'expired';
  return {
    booking,
    slot,
    coach: coachById(slot.coachId),
    refundable,
    deadline: cancellationDeadline(slot),
    batch,
    refundExpired,
  };
}

/**
 * THE CANCELLATION SEAM. The third money-equivalent mutation, mirroring bookSlot.
 *
 * Re-validates and never trusts the caller: rejects a booking that isn't the
 * player's, isn't active, or whose slot has already started. `already_cancelled`
 * is an explicit idempotency guard — the mirror of bookSlot's `already_booked`,
 * and the thing that stops a double-refund (cancel twice → credit back twice).
 *
 * The seat is ALWAYS freed (bookedCount − 1) so someone else can book it, refund
 * or not. The credit is refunded ONLY when @tpa/core's isCancellableWithoutForfeit
 * says so (outside the 3-hour window), and it goes back to booking.creditBatchId —
 * the exact batch that paid — with that batch's ORIGINAL expiry (we only bump
 * quantityRemaining; we never mint a batch or extend expiry). If that batch has
 * since expired, the credit still returns (the ledger tells the truth) and is
 * simply unusable — isBatchUsable rejects it. All three writes commit atomically.
 *
 * MOCK (S3e): commits to the local store. S7 replaces THIS BODY with one atomic DB
 * RPC that frees the seat and conditionally refunds under real concurrency, with a
 * unique/status guard so a double-cancel can't double-refund. Screens are unchanged.
 */
export type CancelBlockReason =
  | 'booking_missing'
  | 'not_owner'
  | 'already_cancelled'
  | 'not_cancellable'
  | 'slot_missing';

export type CancelResult =
  | { ok: true; refunded: boolean; booking: Booking; batch: CreditBatch | null }
  | { ok: false; reason: CancelBlockReason };

export function cancelBooking(player: Player, bookingId: BookingId, now: IsoInstant): CancelResult {
  const booking = getBookings().find((b) => b.id === bookingId);
  if (!booking) return { ok: false, reason: 'booking_missing' };
  if (booking.playerId !== player.id) return { ok: false, reason: 'not_owner' };
  // Idempotency — cancelling an already-cancelled booking must not refund again.
  if (booking.status === 'cancelled') return { ok: false, reason: 'already_cancelled' };
  // attended / no_show are the admin's terminal states, not cancellable.
  if (booking.status !== 'booked') return { ok: false, reason: 'not_cancellable' };

  const slot = getSlots().find((s) => s.id === booking.slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };
  // Can't cancel a session that has already started.
  if (hasStarted(slot, now)) return { ok: false, reason: 'not_cancellable' };

  const refundable = isCancellableWithoutForfeit(slot, now);
  const cancelledBooking: Booking = { ...booking, status: 'cancelled', cancelledAt: now };
  const freedSlot: SessionSlot = { ...slot, bookedCount: Math.max(0, slot.bookedCount - 1) };

  let updatedBatch: CreditBatch | null = null;
  if (refundable) {
    const batch = getBatches().find((b) => b.id === booking.creditBatchId);
    // Return the credit to its original batch, keeping that batch's expiry. If the
    // batch has lapsed, it still returns — worthless — rather than being extended.
    if (batch) updatedBatch = { ...batch, quantityRemaining: batch.quantityRemaining + 1 };
  }

  commitCancellation(cancelledBooking, freedSlot, updatedBatch ?? undefined);
  return { ok: true, refunded: updatedBatch !== null, booking: cancelledBooking, batch: updatedBatch };
}
