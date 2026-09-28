import {
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  parseInstant,
  sameCairoDate,
  type CairoDate,
} from '@tpa/core';
import type { Booking, Coach, IsoInstant, SessionSlot } from '@tpa/types';

/**
 * Schedule derivation — pure over the player's bookings, the published slots, and
 * the coaches (all fetched by the query layer, S9). Screens render dates via
 * @tpa/core. (Catalog helpers live in catalog.ts.)
 */

export interface NextSession {
  slot: SessionSlot;
  coach: Coach | undefined;
}

/** The player's soonest upcoming booked session, joined to its coach. */
export function nextSession(
  bookings: Booking[],
  slots: SessionSlot[],
  coaches: Coach[],
  now: IsoInstant,
): NextSession | null {
  const nowMs = new Date(now).getTime();
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const upcoming = bookings
    .filter((b) => b.status === 'booked')
    .map((b) => slotById.get(b.slotId))
    .filter((s): s is SessionSlot => !!s && new Date(s.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  const slot = upcoming[0];
  if (!slot) return null;
  return { slot, coach: coaches.find((c) => c.id === slot.coachId) };
}

/**
 * How far off the next session is, as a short standalone phrase — "Now",
 * "In 25 min", "In 3 hours", "Tomorrow", "In 3 days".
 *
 * The date and time are on the card already. What they do not answer is the
 * question a player actually has about their NEXT session, which is whether it
 * needs their attention now or sits somewhere in the week. A countdown answers
 * that at a glance; "Wed 30 Sep" makes you work it out.
 *
 * Days are CAIRO CALENDAR days, not 24-hour blocks, which is why "Tomorrow" is
 * here as its own case: a session at 7:30 PM tomorrow is 20 hours away when it
 * is 11 PM tonight, and "In 20 hours" is a true sentence that nobody thinks in.
 * Beyond tomorrow it goes back to counting, because "in 3 days" is how people
 * talk about the rest of the week.
 */
export function sessionCountdown(startsAt: IsoInstant, now: IsoInstant): string {
  const mins = Math.round((parseInstant(startsAt).getTime() - parseInstant(now).getTime()) / 60_000);
  if (mins <= 0) return 'Now';
  if (mins < 60) return `In ${mins} min`;

  const today = cairoCalendarDate(now);
  if (sameCairoDate(startsAt, today)) {
    const hours = Math.round(mins / 60);
    return `In ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (sameCairoDate(startsAt, addCairoDays(today, 1))) return 'Tomorrow';

  // Counted in calendar days from today, so a Friday session is "in 2 days" on
  // Wednesday regardless of the clock times involved.
  const days = cairoDaysBetween(today, cairoCalendarDate(startsAt));
  return `In ${days} days`;
}

/** Whole Cairo calendar days from `from` to `to`, via each day's Cairo midnight. */
function cairoDaysBetween(from: CairoDate, to: CairoDate): number {
  const ms = parseInstant(cairoMidnight(to)).getTime() - parseInstant(cairoMidnight(from)).getTime();
  return Math.round(ms / 86_400_000);
}
