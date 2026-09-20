import { cairoCalendarDate } from '@tpa/core';
import type { IsoInstant, SessionSlot } from '@tpa/types';

/**
 * The coach Schedule tab's shape, as a pure function of the coach's own slots.
 *
 * The screen answers one question — "what am I teaching next, and what else today"
 * — so the grouping is: a hero, the rest of today, then everything after.
 *
 * `hero` is the session IN PROGRESS if there is one, otherwise the next to start. A
 * coach mid-lesson wants the roster in front of them, not the session after it; the
 * fetch keeps a 12-hour tail precisely so a running session is still in hand.
 *
 * Anything already FINISHED is dropped from all three groups. The tail exists to
 * catch the session underway, not to turn the schedule into a history — that is
 * what the Hours tab is for.
 */
export interface CoachSchedule {
  /** In progress now, or the next to start. null when nothing is upcoming. */
  hero: SessionSlot | null;
  /** True when `hero` has already started — the screen says "on court now". */
  heroInProgress: boolean;
  /** The rest of today, after the hero, soonest first. */
  restOfToday: SessionSlot[];
  /** Everything after today, soonest first. */
  later: SessionSlot[];
}

const ms = (i: IsoInstant): number => new Date(i).getTime();

function sameCairoDay(a: IsoInstant, b: IsoInstant): boolean {
  const x = cairoCalendarDate(a);
  const y = cairoCalendarDate(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function coachSchedule(slots: SessionSlot[], now: IsoInstant): CoachSchedule {
  const nowMs = ms(now);
  const live = slots
    .filter((s) => ms(s.endsAt) > nowMs)
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));

  const hero = live[0] ?? null;
  if (!hero) return { hero: null, heroInProgress: false, restOfToday: [], later: [] };

  const rest = live.slice(1);
  return {
    hero,
    heroInProgress: ms(hero.startsAt) <= nowMs,
    restOfToday: rest.filter((s) => sameCairoDay(s.startsAt, now)),
    later: rest.filter((s) => !sameCairoDay(s.startsAt, now)),
  };
}

/**
 * "in 25 minutes" / "in 3 hours" / "in 2 days" — the countdown on the hero card.
 * Deliberately coarse: a coach glancing at this needs to know whether to start
 * walking to the court, not the exact second.
 */
export function startsInLabel(startsAt: IsoInstant, now: IsoInstant): string {
  const mins = Math.round((ms(startsAt) - ms(now)) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
