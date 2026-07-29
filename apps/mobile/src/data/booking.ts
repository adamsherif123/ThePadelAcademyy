import {
  bookableTypesFor,
  cairoCalendarDate,
  cairoWeekStart,
  canBookSlot,
  cancellationDeadline,
  creditExpiryState,
  isCancellableWithoutForfeit,
  isDayOpen,
  slotRemainingCapacity,
  TRAINING_TYPES,
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

export interface DateStripDay extends CairoDay {
  key: string;
  closed: boolean;
  /**
   * Total remaining bookable seats across this day's published, not-yet-started
   * sessions — 0 when closed. This is raw remaining capacity (@tpa/core's
   * `slotRemainingCapacity`), summed once per slot regardless of type — not
   * personalized to credit balance ("browsing is free": a player with zero
   * credits still sees the same day-level room-to-book as anyone else, exactly
   * like the feed below never hides a session for affordability) and not
   * double-counted per type the way the old per-tab filter counted an open
   * block once per affordable tab. Gender is never excluded either (the
   * gender-display-only migration: gender no longer gates who can join, so it
   * has no bearing on this count — a mixed or any-gender-recorded slot's seats
   * count the same as any other). The true per-session verdict is what
   * `sessionsForDay` computes for the feed itself; this chip is deliberately a
   * coarser "is there room" teaser, not a promise, so it doesn't need to
   * re-derive that full verdict.
   */
  spots: number;
}

/** Would `slot` even be a candidate to count as "available" to `player` right now,
 * ignoring credit balance entirely? Mirrors canBookSlot's structural checks
 * (published, not started, has room — gender/level are both display-only now
 * and never gate) without the credit check, since "credits never hide a
 * session" applies to these coarse counts too, not just the booking feed. Reuses
 * `slotRemainingCapacity` (@tpa/core) rather than re-deriving it. */
function isJoinableIgnoringCredit(slot: SessionSlot, now: IsoInstant): boolean {
  if (slot.status !== 'published') return false;
  if (new Date(slot.startsAt).getTime() <= new Date(now).getTime()) return false;
  if (slotRemainingCapacity(slot) <= 0) return false;
  return true;
}

function daySpots(slots: SessionSlot[], now: IsoInstant, day: CairoDay): number {
  return slots
    .filter((s) => sameCairoDay(s.startsAt, day))
    .filter((s) => isJoinableIgnoringCredit(s, now))
    .reduce((sum, s) => sum + slotRemainingCapacity(s), 0);
}

/**
 * `count` consecutive Cairo days starting today, each flagged open/closed via the
 * shared `isDayOpen` rule (@tpa/core) — a day is open if its weekday is
 * template-covered OR this specific date has a published slot (a one-off outside
 * the recurring schedule). See @tpa/core's availability.ts for the full rationale
 * (the same rule the admin week calendar consumes; this used to be two
 * independently-hand-written copies). No `player` parameter — gender was the
 * only per-player filter this ever needed, and it's gone (gender-display-only
 * migration): every player sees the same day-level spot counts now.
 */
export function dateStrip(
  templates: AvailabilityTemplate[],
  slots: SessionSlot[],
  now: IsoInstant,
  count: number,
): DateStripDay[] {
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
    const closed = !isDayOpen(templates, slots, weekday, day);
    return {
      ...day,
      key: `${day.year}-${day.month}-${day.day}`,
      closed,
      spots: closed ? 0 : daySpots(slots, now, day),
    };
  });
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
 * see below). `level_mismatch` is GONE (rule 4: level never blocks) and so is
 * `gender_mismatch` (the gender-display-only migration extends rule 4 to
 * gender) — the browse list still SHOWS both, it just doesn't hide or grey
 * the card for either.
 */
export type SlotAvailability =
  | { kind: 'bookable'; creditBatchId: CreditBatchId; trainingType: TrainingType }
  | { kind: 'booked' }
  | { kind: 'full' }
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
    case 'slot_in_past':
      return { kind: 'past' };
    case 'slot_cancelled':
      return { kind: 'cancelled' };
    // A race: this slot resolved to a different type than `chosenType` between
    // whatever snapshot produced this call and now — someone else's booking
    // fixed it. The next query-cache refresh corrects the verdict; see Task 4's
    // UNBOOKABLE_MESSAGE for the matching confirm-screen copy.
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

/**
 * `slotAvailability`'s counterpart for a still-OPEN block, where there is no
 * single `chosenType` to check. Status/timing/capacity are chosenType-independent
 * for an open (untyped) slot — canBookSlot's own ordering runs those checks
 * before it ever looks at type, and gender is no longer checked anywhere at
 * all (display-only) — so probing with an arbitrary type ('trial') surfaces
 * exactly the same verdict any other probe type would. type_mismatch is
 * structurally unreachable here (open blocks carry no type to mismatch
 * against), so if the probe fails for any OTHER reason it's a genuine credit
 * gap — resolved the same way slotAvailability does, by trying every type via
 * `bookableTypesFor` (the one function that tries all four).
 */
function openBlockAvailability(
  slot: SessionSlot,
  player: Player,
  batches: CreditBatch[],
  bookings: Booking[],
  now: IsoInstant,
): SlotAvailability {
  if (bookedSlotIds(bookings).has(slot.id)) return { kind: 'booked' };

  const structural = canBookSlot(slot, player, batches, now, 'trial');
  if (!structural.ok && structural.reason !== 'no_usable_credit') {
    switch (structural.reason) {
      case 'slot_full':
        return { kind: 'full' };
      case 'slot_in_past':
        return { kind: 'past' };
      default:
        return { kind: 'cancelled' };
    }
  }

  const offered = bookableTypesFor(slot, player, batches, now);
  if (offered.length > 0) {
    const top = offered[0]!;
    return { kind: 'bookable', creditBatchId: top.creditBatchId, trainingType: top.trainingType };
  }
  const lapsed = TRAINING_TYPES.some((t) =>
    batches.some(
      (b) => b.trainingType === t && b.quantityRemaining > 0 && creditExpiryState(b.expiresAt, now) === 'expired',
    ),
  );
  return { kind: lapsed ? 'credits_expired' : 'no_credit' };
}

/** One session on the discovery feed: the slot (typed or still open) paired with
 * its availability verdict for `player` right now. */
export interface DaySession {
  slot: SessionSlot;
  availability: SlotAvailability;
}

/**
 * Every published session on a given Cairo `day` — typed or open — exactly
 * once, chronological. Replaces the old per-type `slotsForType` for the browse
 * feed (Task 1): an open block used to appear once per affordable tab; here it
 * appears once, with a single verdict. A typed slot's verdict comes from the
 * existing `slotAvailability` (gender and level are BOTH display-only now, per
 * rule 4 extended to gender — neither gates); an open block's comes from
 * `openBlockAvailability` above. Neither re-derives a booking rule — both are thin wrappers over
 * `canBookSlot` / `bookableTypesFor`. Credits never hide a row: an unaffordable
 * session still comes back here with a `no_credit` / `credits_expired` verdict,
 * never filtered out — the caller renders it dimmed, exactly as the old
 * `slotDisplay` already did for `no_credit`.
 */
export function sessionsForDay(
  slots: SessionSlot[],
  player: Player,
  batches: CreditBatch[],
  bookings: Booking[],
  now: IsoInstant,
  day: CairoDay,
): DaySession[] {
  return slots
    .filter((s) => s.status === 'published')
    .filter((s) => sameCairoDay(s.startsAt, day))
    .map((slot) => ({
      slot,
      availability:
        slot.trainingType === null
          ? openBlockAvailability(slot, player, batches, bookings, now)
          : slotAvailability(slot, player, batches, bookings, now, slot.trainingType),
    }))
    .sort((a, b) => new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime());
}

export interface WeekAvailabilitySummary {
  sessionsThisWeek: number;
  sessionsToday: number;
  /** The very next joinable-in-principle session, across ALL future slots (not
   * just this week) — a quiet week shouldn't hide a session that's genuinely
   * next Monday. Null when nothing at all is upcoming. */
  nextSessionAt: IsoInstant | null;
}

/**
 * A coarse "is there stuff on" summary for the top of Book: how many
 * joinable-in-principle sessions fall in the REST of this Cairo week
 * (`cairoWeekStart(now)` .. +7 days — the one shared week boundary, per
 * @tpa/core), how many of those are today, and when the very next one starts.
 * Deliberately NOT gated by credit balance (same "browsing is free" reasoning
 * as `dateStrip`'s spots count). No `player` parameter — gender was the only
 * per-player exclusion this ever needed, and it's gone (gender-display-only
 * migration): a mixed or any-gender-recorded slot counts the same for every
 * player now.
 */
export function weekAvailabilitySummary(
  slots: SessionSlot[],
  now: IsoInstant,
): WeekAvailabilitySummary {
  const weekStartMs = new Date(cairoWeekStart(now)).getTime();
  const weekEndMs = weekStartMs + 7 * 86_400_000;
  const today = cairoCalendarDate(now);

  const upcoming = slots
    .filter((s) => isJoinableIgnoringCredit(s, now))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const thisWeek = upcoming.filter((s) => {
    const startMs = new Date(s.startsAt).getTime();
    return startMs >= weekStartMs && startMs < weekEndMs;
  });

  return {
    sessionsThisWeek: thisWeek.length,
    sessionsToday: upcoming.filter((s) => sameCairoDay(s.startsAt, today)).length,
    nextSessionAt: upcoming[0]?.startsAt ?? null,
  };
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
