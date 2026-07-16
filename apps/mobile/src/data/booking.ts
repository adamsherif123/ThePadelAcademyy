import { cairoCalendarDate, canBookSlot, creditExpiryState } from '@tpa/core';
import { mockBookings, mockCoaches, mockSlots, mockTemplates } from '@tpa/mocks';
import type {
  Coach,
  CreditBatchId,
  IsoInstant,
  Player,
  SessionSlot,
  SlotId,
  TrainingType,
  Weekday,
} from '@tpa/types';

import { getBatches } from './store';

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
  return mockSlots
    .filter((s) => s.status === 'published' && s.trainingType === trainingType)
    .filter((s) => sameCairoDay(s.startsAt, day))
    .filter((s) => trainingType !== 'group' || (s.gender === player.gender && s.level === player.level))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

/** Slot ids the player currently has an active (`booked`) booking for. */
export function bookedSlotIds(playerId: Player['id']): Set<SlotId> {
  return new Set(
    mockBookings.filter((b) => b.playerId === playerId && b.status === 'booked').map((b) => b.slotId),
  );
}

export function coachById(id: Coach['id']): Coach | undefined {
  return mockCoaches.find((c) => c.id === id);
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
