import type { AvailabilityTemplate, IsoInstant, LocalTime, Weekday } from '@tpa/types';

import { CAIRO_TZ } from './constants';

/**
 * The whole timezone strategy in one place: store instants in UTC, convert to and
 * from Cairo wall-clock using the platform-native `Intl` API — no date library,
 * so this stays runtime-agnostic (Node, Deno, browser, and React Native, where
 * Intl is provided by the host OS). Egypt observes DST and, since 2023, suspends
 * it during Ramadan, so a fixed +02/+03 offset is wrong twice a year (and more
 * around Ramadan). Everything here derives the offset from tzdata via Intl.
 */

/** Build an IsoInstant (branded UTC ISO string) from a Date. */
export function toInstant(date: Date): IsoInstant {
  return date.toISOString() as IsoInstant;
}

/** Parse an IsoInstant back into a Date. */
export function parseInstant(instant: IsoInstant): Date {
  return new Date(instant);
}

const OFFSET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Offset, in milliseconds, of Cairo from UTC at a given instant (+7200000 in
 * winter, +10800000 during DST). Computed by asking Intl what the Cairo wall
 * time is at that instant and differencing it from the UTC wall time.
 */
export function cairoOffsetMs(instant: Date): number {
  const p = Object.fromEntries(
    OFFSET_PARTS.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;

  const wallAsUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // Intl has no sub-second parts; compare against the instant floored to seconds.
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return wallAsUtc - instantSeconds;
}

/**
 * Convert a Cairo wall-clock date+time to a UTC instant, DST-correct.
 *
 * Two-pass: guess the offset from the naive UTC interpretation, apply it, then
 * re-read the offset at the candidate instant and correct if we landed on the
 * other side of a DST transition. This resolves the spring-forward / fall-back
 * boundaries without any hard-coded rules.
 */
export function cairoWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): IsoInstant {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = cairoOffsetMs(new Date(naiveUtc));
  let utc = naiveUtc - firstOffset;
  const secondOffset = cairoOffsetMs(new Date(utc));
  if (secondOffset !== firstOffset) {
    utc = naiveUtc - secondOffset;
  }
  return toInstant(new Date(utc));
}

/** The Cairo calendar Y/M/D (and weekday) an instant falls on. */
export function cairoCalendarDate(instant: IsoInstant): {
  year: number;
  month: number;
  day: number;
  weekday: Weekday;
} {
  const d = parseInstant(instant);
  const offset = cairoOffsetMs(d);
  const shifted = new Date(d.getTime() + offset); // read UTC getters as Cairo wall time
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay() as Weekday,
  };
}

/** A Cairo calendar date with no time-of-day. */
export interface CairoDate {
  year: number;
  month: number;
  day: number;
}

/** Cairo-local midnight (00:00) of a Cairo calendar date, as a UTC instant. */
export function cairoMidnight(date: CairoDate): IsoInstant {
  return cairoWallTimeToInstant(date.year, date.month, date.day, 0, 0);
}

/**
 * Shift a Cairo calendar date by whole days. Pure calendar arithmetic via UTC
 * midnight (which has no DST), so it never mis-counts across an Egyptian DST
 * transition the way adding 86.4M ms to an instant would.
 */
export function addCairoDays(date: CairoDate, delta: number): CairoDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + delta * 86_400_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * Cairo-midnight of the SUNDAY that opens the Cairo week containing `now`
 * (weekday 0 = Sunday). The ONE definition of "the start of this week" — the
 * dashboard, coach stats, and the week calendar all derive their week from here
 * rather than each re-deriving Sunday arithmetic (they used to; that drifted).
 */
export function cairoWeekStart(now: IsoInstant): IsoInstant {
  const c = cairoCalendarDate(now);
  return cairoMidnight(addCairoDays({ year: c.year, month: c.month, day: c.day }, -c.weekday));
}

/** Parse a `HH:mm` LocalTime into numeric hours/minutes. */
export function parseLocalTime(time: LocalTime): { hour: number; minute: number } {
  const [h, m] = time.split(':');
  return { hour: Number(h), minute: Number(m) };
}

/**
 * Materialize one AvailabilityTemplate onto a specific Cairo calendar date,
 * producing the concrete UTC start/end instants for a SessionSlot. Pure: the
 * caller decides which date (S7 slot-generation will iterate dates). The date is
 * interpreted as Cairo-local; DST is handled by cairoWallTimeToInstant.
 */
export function materializeTemplateSlot(
  template: AvailabilityTemplate,
  cairoDate: { year: number; month: number; day: number },
): { startsAt: IsoInstant; endsAt: IsoInstant } {
  const start = parseLocalTime(template.startTime);
  const end = parseLocalTime(template.endTime);
  return {
    startsAt: cairoWallTimeToInstant(
      cairoDate.year,
      cairoDate.month,
      cairoDate.day,
      start.hour,
      start.minute,
    ),
    endsAt: cairoWallTimeToInstant(
      cairoDate.year,
      cairoDate.month,
      cairoDate.day,
      end.hour,
      end.minute,
    ),
  };
}
