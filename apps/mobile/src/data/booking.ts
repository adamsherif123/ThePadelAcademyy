import {
  cairoCalendarDate,
  canBookSlot,
  cancellationDeadline,
  creditExpiryState,
  isCancellableWithoutForfeit,
} from '@tpa/core';
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

import { balanceByType } from './wallet';

/**
 * Booking derivations — pure functions of the rows the query layer fetched from
 * Supabase (published slots, the player's own bookings + credit batches, active
 * coaches). Availability is NOT reimplemented: each verdict calls @tpa/core's
 * canBookSlot, the client-side PREVIEW of the book_slot RPC that actually enforces
 * it. The two mutation seams that used to live here (bookSlot / cancelBooking) are
 * now the server RPCs in ../lib/api and the mutations in ./queries — this file is
 * read-only derivation.
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
 * The weekdays the academy operates — DERIVED from the published slots the client
 * can see. (Availability templates are admin-only under RLS, so unlike the mock we
 * can't read them here; the published schedule is the client's source of truth.) A
 * weekday with at least one published slot is open.
 */
export function operatingWeekdays(slots: SessionSlot[]): Set<Weekday> {
  const open = new Set<Weekday>();
  for (const s of slots) {
    if (s.status === 'published') open.add(cairoCalendarDate(s.startsAt).weekday as Weekday);
  }
  return open;
}

export function isClosedWeekday(slots: SessionSlot[], weekday: Weekday): boolean {
  return !operatingWeekdays(slots).has(weekday);
}

export interface DateStripDay extends CairoDay {
  key: string;
  closed: boolean;
}

/** `count` consecutive Cairo days starting today, each flagged open/closed. */
export function dateStrip(slots: SessionSlot[], now: IsoInstant, count: number): DateStripDay[] {
  const open = operatingWeekdays(slots);
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
    return { ...day, key: `${day.year}-${day.month}-${day.day}`, closed: !open.has(weekday) };
  });
}

/**
 * Published slots of `trainingType` on `day`, sorted by start. Group slots are
 * matched to the player's profile (gender AND level); duo/individual/trial don't.
 */
export function slotsForType(
  slots: SessionSlot[],
  trainingType: TrainingType,
  player: Player,
  day: CairoDay,
): SessionSlot[] {
  return slots
    .filter((s) => s.status === 'published' && s.trainingType === trainingType)
    .filter((s) => sameCairoDay(s.startsAt, day))
    .filter((s) => trainingType !== 'group' || (s.gender === player.gender && s.level === player.level))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/**
 * Slot ids the player holds a NON-CANCELLED booking for. Only a cancellation frees
 * the seat, so this is exactly the set that blocks a second booking — mirroring the
 * DB's partial unique index on (player, slot) WHERE status <> 'cancelled'.
 */
export function bookedSlotIds(bookings: Booking[]): Set<SlotId> {
  return new Set(bookings.filter((b) => b.status !== 'cancelled').map((b) => b.slotId));
}

export function coachById(coaches: Coach[], id: Coach['id']): Coach | undefined {
  return coaches.find((c) => c.id === id);
}

export function slotById(slots: SessionSlot[], id: SlotId): SessionSlot | undefined {
  return slots.find((s) => s.id === id);
}

/** Everything the confirm screen needs for one slot. */
export interface BookingPreview {
  slot: SessionSlot;
  coach: Coach | undefined;
  verdict: ReturnType<typeof canBookSlot>;
  batch: CreditBatch | undefined;
  typeBalance: number;
  alreadyBooked: boolean;
}

export function bookingPreview(
  ctx: { slots: SessionSlot[]; coaches: Coach[]; batches: CreditBatch[]; bookings: Booking[] },
  player: Player,
  slotId: SlotId,
  now: IsoInstant,
): BookingPreview | null {
  const slot = slotById(ctx.slots, slotId);
  if (!slot) return null;
  const verdict = canBookSlot(slot, player, ctx.batches, now);
  const batch = verdict.ok ? ctx.batches.find((b) => b.id === verdict.creditBatchId) : undefined;
  return {
    slot,
    coach: coachById(ctx.coaches, slot.coachId),
    verdict,
    batch,
    typeBalance: balanceByType(ctx.batches, now)[slot.trainingType],
    alreadyBooked: bookedSlotIds(ctx.bookings).has(slotId),
  };
}

/**
 * Why a slot can or can't be booked, for the current player, right now. Wraps
 * canBookSlot and adds two UI-only distinctions core doesn't make: `booked` and
 * `credits_expired` vs `no_credit`.
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
  batches: CreditBatch[],
  bookings: Booking[],
  now: IsoInstant,
): SlotAvailability {
  if (bookedSlotIds(bookings).has(slot.id)) return { kind: 'booked' };

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

/** A booking paired with its slot and coach, for the Sessions lists. */
export interface SessionEntry {
  booking: Booking;
  slot: SessionSlot;
  coach: Coach | undefined;
}

function sessionEntries(
  bookings: Booking[],
  slots: SessionSlot[],
  coaches: Coach[],
): SessionEntry[] {
  return bookings
    .map((b) => {
      const slot = slotById(slots, b.slotId);
      return slot ? { booking: b, slot, coach: coachById(coaches, slot.coachId) } : null;
    })
    .filter((e): e is SessionEntry => e !== null);
}

function hasStarted(slot: SessionSlot, now: IsoInstant): boolean {
  return new Date(slot.startsAt).getTime() <= new Date(now).getTime();
}

/** Active (`booked`) bookings whose slot has not started, soonest first. */
export function upcomingSessions(
  bookings: Booking[],
  slots: SessionSlot[],
  coaches: Coach[],
  now: IsoInstant,
): SessionEntry[] {
  return sessionEntries(bookings, slots, coaches)
    .filter((e) => e.booking.status === 'booked' && !hasStarted(e.slot, now))
    .sort((a, b) => new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime());
}

/** Everything else — started sessions and any cancelled booking. Most recent first. */
export function pastSessions(
  bookings: Booking[],
  slots: SessionSlot[],
  coaches: Coach[],
  now: IsoInstant,
): SessionEntry[] {
  return sessionEntries(bookings, slots, coaches)
    .filter((e) => !(e.booking.status === 'booked' && !hasStarted(e.slot, now)))
    .sort((a, b) => new Date(b.slot.startsAt).getTime() - new Date(a.slot.startsAt).getTime());
}

/** Everything the cancel screen needs for one booking. */
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
  ctx: { slots: SessionSlot[]; coaches: Coach[]; batches: CreditBatch[]; bookings: Booking[] },
  bookingId: BookingId,
  now: IsoInstant,
): CancelPreview | null {
  const booking = ctx.bookings.find((b) => b.id === bookingId);
  if (!booking) return null;
  const slot = slotById(ctx.slots, booking.slotId);
  if (!slot) return null;
  const batch = ctx.batches.find((b) => b.id === booking.creditBatchId);
  const refundable = isCancellableWithoutForfeit(slot, now);
  const refundExpired =
    refundable && batch !== undefined && creditExpiryState(batch.expiresAt, now) === 'expired';
  return {
    booking,
    slot,
    coach: coachById(ctx.coaches, slot.coachId),
    refundable,
    deadline: cancellationDeadline(slot),
    batch,
    refundExpired,
  };
}
