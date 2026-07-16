import type { IsoInstant, Piastres } from '@tpa/types';

import { CAIRO_TZ, PIASTRES_PER_EGP } from './constants';
import { cairoCalendarDate, parseInstant } from './time';

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

/** e.g. "Tue, 14 Jul" in Cairo time. */
export function formatInstantDate(instant: IsoInstant): string {
  return DATE_FMT.format(parseInstant(instant));
}

/** e.g. "6:00 PM" in Cairo time. */
export function formatInstantTime(instant: IsoInstant): string {
  return TIME_FMT.format(parseInstant(instant));
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
