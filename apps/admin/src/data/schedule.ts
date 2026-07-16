import { cairoCalendarDate, cairoOffsetMs, cairoWallTimeToInstant, parseInstant } from '@tpa/core';
import type { IsoInstant, SessionSlot, Weekday } from '@tpa/types';

import { getSlots, getTemplates } from './store';

/**
 * Week-calendar selectors — pure, Cairo-correct (a UTC grid would shift every
 * event by the offset). S10 swaps the store internals underneath, unchanged.
 */

const DAY_MS = 86_400_000;
const ms = (i: IsoInstant): number => parseInstant(i).getTime();

interface CairoDate {
  year: number;
  month: number;
  day: number;
}

const cairoMidnight = (d: CairoDate): IsoInstant => cairoWallTimeToInstant(d.year, d.month, d.day, 0, 0);

/** Shift a Cairo calendar date by whole days (DST-safe: pure calendar arithmetic). */
function addDays(d: CairoDate, delta: number): CairoDate {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day) + delta * DAY_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Minutes since Cairo midnight for an instant — the vertical position in the grid. */
export function cairoWallMinutes(instant: IsoInstant): number {
  const dt = parseInstant(instant);
  const shifted = new Date(dt.getTime() + cairoOffsetMs(dt));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Weekdays with NO active template from any coach are CLOSED — derived from
 * availability data, never hardcoded (the same rule the client app's date strip
 * uses). Add a Thursday template and Thursday opens with no code change.
 */
export function closedWeekdays(): Set<Weekday> {
  const open = new Set<Weekday>();
  for (const t of getTemplates()) if (t.isActive) open.add(t.weekday);
  return new Set(([0, 1, 2, 3, 4, 5, 6] as Weekday[]).filter((w) => !open.has(w)));
}

export interface DayColumn {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: Weekday;
  date: CairoDate;
  /** Cairo midnight of this day. */
  dayStart: IsoInstant;
  isToday: boolean;
  isClosed: boolean;
}

/** The 7 Sun–Sat columns of the week `weekOffset` weeks from now's Cairo week. */
export function weekColumns(now: IsoInstant, weekOffset: number): DayColumn[] {
  const c = cairoCalendarDate(now);
  const sunday = addDays({ year: c.year, month: c.month, day: c.day }, -c.weekday + weekOffset * 7);
  const closed = closedWeekdays();
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(sunday, i);
    const isToday = date.year === c.year && date.month === c.month && date.day === c.day && weekOffset === 0;
    return {
      weekday: i as Weekday,
      date,
      dayStart: cairoMidnight(date),
      isToday,
      isClosed: closed.has(i as Weekday),
    };
  });
}

/** Published slots that start on the Cairo day beginning at `dayStart`, earliest first. */
export function slotsForDay(dayStart: IsoInstant): SessionSlot[] {
  const start = ms(dayStart);
  const end = start + DAY_MS;
  return getSlots()
    .filter((s) => s.status === 'published' && ms(s.startsAt) >= start && ms(s.startsAt) < end)
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}

/** How many published slots fall in the given columns — for the empty-week state. */
export function weekHasSlots(columns: readonly DayColumn[]): boolean {
  return columns.some((col) => slotsForDay(col.dayStart).length > 0);
}
