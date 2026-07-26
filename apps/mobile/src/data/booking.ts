import {
  bookableTypesFor,
  cairoCalendarDate,
  canBookSlot,
  cancellationDeadline,
  creditExpiryState,
  isCancellableWithoutForfeit,
} from '@tpa/core';
import type {
  AvailabilityTemplate,
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
 * The weekdays the academy operates — DERIVED from active availability templates,
 * which a signed-in (non-admin) player CAN read under RLS policy
 * `availability_templates_select_active` (S5.1). This deliberately separates two
 * states the published schedule alone can't: a CLOSED weekday (no active template —
 * the academy doesn't run that day) versus an OPEN weekday with nothing scheduled
 * yet (a template exists but no slots are published / all were cancelled). Deriving
 * "open" from slots would collapse the second into the first — a week Rania hasn't
 * generated slots for would read as a shut academy.
 */
export function operatingWeekdays(templates: AvailabilityTemplate[]): Set<Weekday> {
  return new Set(templates.filter((t) => t.isActive).map((t) => t.weekday));
}

export function isClosedWeekday(templates: AvailabilityTemplate[], weekday: Weekday): boolean {
  return !operatingWeekdays(templates).has(weekday);
}

export interface DateStripDay extends CairoDay {
  key: string;
  closed: boolean;
}

/** `count` consecutive Cairo days starting today, each flagged open/closed. */
export function dateStrip(
  templates: AvailabilityTemplate[],
  now: IsoInstant,
  count: number,
): DateStripDay[] {
  const open = operatingWeekdays(templates);
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
 * Published slots BOOKABLE AS `trainingType` on `day`, sorted by start — either
 * already typed `trainingType`, or OPEN (untyped) and affordable as
 * `trainingType` per bookableTypesFor (so an open block appears under every
 * tab the player could actually create it as, not just one). A typed group
 * slot is gated to the player's GENDER (the one hard block, rule 4); level is
 * display-only and never excludes a session from this list — an intermediate
 * player still sees a beginner slot and self-selects out, they just aren't
 * hidden from it. An open block carries no gender/level yet (group_shape), so
 * it's never gender-filtered here — anyone can attempt it, exactly per Task 2.
 */
export function slotsForType(
  slots: SessionSlot[],
  trainingType: TrainingType,
  player: Player,
  batches: CreditBatch[],
  now: IsoInstant,
  day: CairoDay,
): SessionSlot[] {
  return slots
    .filter((s) => s.status === 'published')
    .filter((s) => sameCairoDay(s.startsAt, day))
    .filter((s) => {
      if (s.trainingType === trainingType) return trainingType !== 'group' || s.gender === player.gender;
      if (s.trainingType === null) {
        return bookableTypesFor(s, player, batches, now).some((bt) => bt.trainingType === trainingType);
      }
      return false;
    })
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

/**
 * `chosenType` is the type this booking attempt would use — the slot's own
 * type if it's already fixed, or the player's pick from the type picker if
 * it's still open. Returns null (same "not found" contract as a missing slot)
 * if the slot is open and no chosenType was supplied: a correct client always
 * routes an open block through the picker first, so this combination should
 * be unreachable — see the confirm-booking screen's guard.
 */
export function bookingPreview(
  ctx: { slots: SessionSlot[]; coaches: Coach[]; batches: CreditBatch[]; bookings: Booking[] },
  player: Player,
  slotId: SlotId,
  now: IsoInstant,
  chosenType: TrainingType | null,
): BookingPreview | null {
  const slot = slotById(ctx.slots, slotId);
  if (!slot) return null;
  const effectiveType = slot.trainingType ?? chosenType;
  if (effectiveType === null) return null;
  const verdict = canBookSlot(slot, player, ctx.batches, now, effectiveType);
  const batch = verdict.ok ? ctx.batches.find((b) => b.id === verdict.creditBatchId) : undefined;
  return {
    slot,
    coach: coachById(ctx.coaches, slot.coachId),
    verdict,
    batch,
    typeBalance: balanceByType(ctx.batches, now)[verdict.ok ? verdict.trainingType : effectiveType],
    alreadyBooked: bookedSlotIds(ctx.bookings).has(slotId),
  };
}

/**
 * Why a slot can or can't be booked AS `chosenType`, for the current player,
 * right now. Wraps canBookSlot and adds UI-only distinctions core doesn't
 * make: `booked`, `credits_expired` vs `no_credit`, and `type_taken` (a race —
 * see below). `level_mismatch` is GONE (rule 4: level never blocks; the
 * browse list still SHOWS the level, it just doesn't hide or grey the card).
 */
export type SlotAvailability =
  | { kind: 'bookable'; creditBatchId: CreditBatchId; trainingType: TrainingType }
  | { kind: 'booked' }
  | { kind: 'full' }
  | { kind: 'gender_mismatch' }
  | { kind: 'type_taken' }
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
  chosenType: TrainingType,
): SlotAvailability {
  if (bookedSlotIds(bookings).has(slot.id)) return { kind: 'booked' };

  const res = canBookSlot(slot, player, batches, now, chosenType);
  if (res.ok) return { kind: 'bookable', creditBatchId: res.creditBatchId, trainingType: res.trainingType };

  switch (res.reason) {
    case 'slot_full':
      return { kind: 'full' };
    case 'gender_mismatch':
      return { kind: 'gender_mismatch' };
    case 'slot_in_past':
      return { kind: 'past' };
    case 'slot_cancelled':
      return { kind: 'cancelled' };
    // A race: this slot was open (or typed differently) when the list was
    // built, and someone else's booking has since fixed a different type —
    // slotsForType only ever put it in THIS tab because it looked affordable,
    // so reaching type_mismatch here means the world moved. The next
    // query-cache refresh drops it from this tab (or shows it, correctly, in
    // whichever tab actually won) — see Task 4's UNBOOKABLE_MESSAGE for the
    // matching confirm-screen copy.
    case 'type_mismatch':
      return { kind: 'type_taken' };
    case 'no_usable_credit': {
      const lapsed = batches
        .filter((b) => b.trainingType === chosenType)
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
