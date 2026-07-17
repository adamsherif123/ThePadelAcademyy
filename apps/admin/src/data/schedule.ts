import {
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  cairoOffsetMs,
  cairoWallTimeToInstant,
  parseInstant,
  type CairoDate,
} from '@tpa/core';
import type { AvailabilityTemplate, CoachId, IsoInstant, SessionSlot, SlotId, Weekday } from '@tpa/types';

import { assignLanes } from './lanes';

/**
 * Week-calendar selectors — pure, Cairo-correct (a UTC grid would shift every
 * event by the offset). Cairo day/midnight arithmetic comes from @tpa/core (the
 * canonical version). S10 swaps the store internals underneath, unchanged.
 */

const DAY_MS = 86_400_000;
const ms = (i: IsoInstant): number => parseInstant(i).getTime();

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
export function closedWeekdays(templates: AvailabilityTemplate[]): Set<Weekday> {
  const open = new Set<Weekday>();
  for (const t of templates) if (t.isActive) open.add(t.weekday);
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
export function weekColumns(templates: AvailabilityTemplate[], now: IsoInstant, weekOffset: number): DayColumn[] {
  const c = cairoCalendarDate(now);
  const sunday = addCairoDays({ year: c.year, month: c.month, day: c.day }, -c.weekday + weekOffset * 7);
  const closed = closedWeekdays(templates);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addCairoDays(sunday, i);
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
export function slotsForDay(slots: SessionSlot[], dayStart: IsoInstant): SessionSlot[] {
  const start = ms(dayStart);
  const end = start + DAY_MS;
  return slots
    .filter((s) => s.status === 'published' && ms(s.startsAt) >= start && ms(s.startsAt) < end)
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}

/** How many published slots fall in the given columns — for the empty-week state. */
export function weekHasSlots(slots: SessionSlot[], columns: readonly DayColumn[]): boolean {
  return columns.some((col) => slotsForDay(slots, col.dayStart).length > 0);
}

/**
 * Cairo wall-clock (a calendar date + start minute-of-day + duration) → the UTC
 * start/end instants a slot stores. EVERY conversion goes through @tpa/core's
 * cairoWallTimeToInstant, which is DST-correct across both Egyptian transitions —
 * a hand-rolled +2/+3 offset would be wrong twice a year with no error anywhere.
 * The end is computed as a WALL time (rolling the clock, and the date if it passes
 * midnight) and then converted, so a session is defined by its wall times on both
 * ends rather than by adding raw milliseconds across a DST edge.
 */
export function slotTimesFromWall(
  year: number,
  month: number,
  day: number,
  startMinutes: number,
  durationMinutes: number,
): { startsAt: IsoInstant; endsAt: IsoInstant } {
  const endTotal = startMinutes + durationMinutes;
  const rollDays = Math.floor(endTotal / (24 * 60));
  const endMin = ((endTotal % (24 * 60)) + 24 * 60) % (24 * 60);
  const end = addCairoDays({ year, month, day }, rollDays);
  return {
    startsAt: cairoWallTimeToInstant(year, month, day, Math.floor(startMinutes / 60), startMinutes % 60),
    endsAt: cairoWallTimeToInstant(end.year, end.month, end.day, Math.floor(endMin / 60), endMin % 60),
  };
}

/**
 * Another ACTIVE published slot for the same coach whose time overlaps
 * [startsAt, endsAt) — the coach can't be in two places. Touching boundaries do
 * NOT conflict (6–8 and 8–10 are fine), matching the lane algorithm's rule. Pure
 * app-level detection; the durable fix is a DB EXCLUDE constraint (see report).
 */
export function findCoachConflict(
  slots: SessionSlot[],
  coachId: CoachId,
  startsAt: IsoInstant,
  endsAt: IsoInstant,
  excludeSlotId: SlotId,
): SessionSlot | undefined {
  const s = parseInstant(startsAt).getTime();
  const e = parseInstant(endsAt).getTime();
  return slots.find(
    (slot) =>
      slot.id !== excludeSlotId &&
      slot.coachId === coachId &&
      slot.status === 'published' &&
      parseInstant(slot.startsAt).getTime() < e &&
      s < parseInstant(slot.endsAt).getTime(),
  );
}

const NOON = 12 * 60;
const MIDNIGHT = 24 * 60;

/**
 * The Cairo-minute span the grid covers, in whole hours. DERIVED, not fixed:
 * midday→midnight as the baseline (the normal view), EXTENDED to include any slot
 * this week that falls outside it — so an 8 AM one-off shows at its true position
 * instead of being clamped to an edge. Deriving is more robust than a fixed range
 * that merely happens to fit today's data.
 */
export function weekTimeRange(slots: SessionSlot[], columns: readonly DayColumn[]): { startMin: number; endMin: number } {
  let startMin = NOON;
  let endMin = MIDNIGHT;
  for (const col of columns) {
    for (const s of slotsForDay(slots, col.dayStart)) {
      startMin = Math.min(startMin, cairoWallMinutes(s.startsAt));
      endMin = Math.max(endMin, cairoWallMinutes(s.endsAt));
    }
  }
  return { startMin: Math.floor(startMin / 60) * 60, endMin: Math.ceil(endMin / 60) * 60 };
}

/**
 * Vertical box for an event, CLAMPED into the grid. This is the structural
 * guarantee that no event can EVER render outside the grid at any range — even a
 * slot outside the derived span (a computation slip, an out-of-range one-off)
 * pins to an edge with a minimum height rather than escaping over the page.
 */
export function eventBox(
  startMin: number,
  endMin: number,
  gridStartMin: number,
  hourPx: number,
  gridPx: number,
  minPx = 24,
): { top: number; height: number } {
  const rawTop = ((startMin - gridStartMin) / 60) * hourPx;
  const rawHeight = ((endMin - startMin) / 60) * hourPx;
  const top = Math.max(0, Math.min(rawTop, gridPx - minPx));
  const height = Math.max(minPx, Math.min(rawHeight, gridPx - top));
  return { top, height };
}

export interface PlacedEvent {
  slot: SessionSlot;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  lanes: number;
}

/**
 * Lay out one day's slots: horizontal lanes (assignLanes) + vertical clamped
 * boxes (eventBox). Pure — the calendar just applies each result to ONE element,
 * so lane geometry and time geometry can't drift onto separate overlapping nodes.
 */
export function layoutDay(
  slots: readonly SessionSlot[],
  gridStartMin: number,
  hourPx: number,
  gridPx: number,
): PlacedEvent[] {
  const placed = assignLanes(slots, (s) => ({
    startMs: parseInstant(s.startsAt).getTime(),
    endMs: parseInstant(s.endsAt).getTime(),
  }));
  return placed.map(({ item, lane, lanes }) => {
    const box = eventBox(
      cairoWallMinutes(item.startsAt),
      cairoWallMinutes(item.endsAt),
      gridStartMin,
      hourPx,
      gridPx,
    );
    return { slot: item, top: box.top, height: box.height, leftPct: (lane / lanes) * 100, widthPct: (1 / lanes) * 100, lanes };
  });
}
