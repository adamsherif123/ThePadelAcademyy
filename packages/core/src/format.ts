import type { IsoInstant, LocalTime, Piastres } from '@tpa/types';

import { CAIRO_TZ, PIASTRES_PER_EGP } from './constants';
import { cairoCalendarDate, parseInstant, parseLocalTime } from './time';

/**
 * The ONE place in the codebase where money, dates, and times become display
 * strings. Nothing else may format them. All rendering is in Africa/Cairo.
 */

/**
 * Piastres -> display EGP, e.g. 160000 -> "1,600 EGP", 55050 -> "550.50 EGP".
 * Whole-pound amounts show no decimals; a piastres remainder shows exactly two.
 */
export function formatPiastres(amount: Piastres): string {
  const egp = amount / PIASTRES_PER_EGP;
  const hasFraction = amount % PIASTRES_PER_EGP !== 0;
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(egp);
  return `${number} EGP`;
}

/**
 * Compact EGP for dense chart labels — axis ticks and the donut hole — where the
 * full "512,700 EGP" is too wide. Whole thousands drop the decimal ("80k"),
 * others keep one ("512.7k"); millions use "M". No "EGP" suffix (the chart states
 * the unit once). Precise money still renders via formatPiastres.
 */
export function formatCompactEgp(amount: Piastres): string {
  const egp = amount / PIASTRES_PER_EGP;
  const compact = (n: number, suffix: string) =>
    `${Number.isInteger(n) ? String(n) : n.toFixed(1)}${suffix}`;
  if (Math.abs(egp) >= 1_000_000) return compact(egp / 1_000_000, 'M');
  if (Math.abs(egp) >= 1_000) return compact(egp / 1_000, 'k');
  return String(Math.round(egp));
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO_TZ,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
});

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const MONTH_DAY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  month: 'short',
  day: 'numeric',
});

/** e.g. "Jul 19" in Cairo time — for the calendar's week-range header. */
export function formatMonthDay(instant: IsoInstant): string {
  return MONTH_DAY_FMT.format(parseInstant(instant));
}

const HOUR_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TZ,
  hour: 'numeric',
  hour12: true,
});

/**
 * Just the Cairo hour, e.g. "6 PM" — for dense calendar cards where "6:00 PM" is
 * too wide. Drops minutes, so callers must use formatInstantTime when a slot
 * starts off the hour (e.g. 6:30).
 */
export function formatHour(instant: IsoInstant): string {
  return HOUR_FMT.format(parseInstant(instant));
}

/**
 * A LocalTime wall-clock ("18:00" / "18:30") → 12-hour display ("6 PM" / "6:30 PM").
 * No timezone is involved — a template's start/end are wall times, not instants —
 * so this is plain clock arithmetic, never Intl. On-the-hour times drop the minutes.
 */
export function formatLocalTime(time: LocalTime): string {
  const { hour, minute } = parseLocalTime(time);
  const period = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** A wall-clock range for a template row, e.g. "6 PM – 8 PM". */
export function formatLocalTimeRange(start: LocalTime, end: LocalTime): string {
  return `${formatLocalTime(start)} – ${formatLocalTime(end)}`;
}

/** e.g. "Tue, 14 Jul" in Cairo time. */
export function formatInstantDate(instant: IsoInstant): string {
  return DATE_FMT.format(parseInstant(instant));
}

/** e.g. "6:00 PM" in Cairo time. */
export function formatInstantTime(instant: IsoInstant): string {
  return TIME_FMT.format(parseInstant(instant));
}

/**
 * Compact Cairo day/month with no leading zeros, e.g. "31/5" — for dense chart
 * axes where the full "Sat, 31 May" is too wide. Cairo calendar day, not UTC.
 */
export function formatDayMonth(instant: IsoInstant): string {
  const c = cairoCalendarDate(instant);
  return `${c.day}/${c.month}`;
}

/**
 * A session's date + time range in Cairo, e.g. "Tue, 14 Jul · 6:00 – 7:00 PM".
 * The date is shown once; both ends render in Cairo time.
 */
export function formatSessionTimeRange(startsAt: IsoInstant, endsAt: IsoInstant): string {
  return `${formatInstantDate(startsAt)} · ${formatInstantTime(startsAt)} – ${formatInstantTime(endsAt)}`;
}

/** Whole Cairo-calendar-day difference (b − a); positive when b is later. */
function cairoDayDiff(a: IsoInstant, b: IsoInstant): number {
  const ca = cairoCalendarDate(a);
  const cb = cairoCalendarDate(b);
  const utcA = Date.UTC(ca.year, ca.month - 1, ca.day);
  const utcB = Date.UTC(cb.year, cb.month - 1, cb.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * Human expiry for a credit batch, relative to `now`. Both are compared as
 * instants first (so "expired" is exact to the second), then by Cairo calendar
 * day for the friendly countdown the client shows on the wallet.
 *
 *   past instant            -> "expired"
 *   past, same Cairo day   -> "expired today"
 *   past, previous day     -> "expired yesterday"
 *   past, n days ago       -> "expired n days ago"
 *   same Cairo day as now  -> "expires today"
 *   next Cairo day         -> "expires tomorrow"
 *   n days out             -> "expires in n days"
 */
export function formatExpiry(expiresAt: IsoInstant, now: IsoInstant): string {
  if (parseInstant(expiresAt).getTime() <= parseInstant(now).getTime()) {
    const daysAgo = cairoDayDiff(expiresAt, now);
    if (daysAgo <= 0) return 'expired today';
    if (daysAgo === 1) return 'expired yesterday';
    return `expired ${daysAgo} days ago`;
  }
  const days = cairoDayDiff(now, expiresAt);
  if (days <= 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}
