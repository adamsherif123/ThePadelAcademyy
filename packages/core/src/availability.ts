import type { AvailabilityTemplate, SessionSlot, Weekday } from '@tpa/types';

import { sameCairoDate, type CairoDate } from './time';

/**
 * Weekdays covered by at least one active recurring template — the "this weekday
 * runs every week" signal, independent of whether any slot has been generated for
 * a particular occurrence of it yet.
 */
export function templateCoveredWeekdays(templates: readonly AvailabilityTemplate[]): Set<Weekday> {
  return new Set(templates.filter((t) => t.isActive).map((t) => t.weekday));
}

/**
 * Whether a specific Cairo calendar date is open — the ONE rule both apps must
 * share (mobile's date strip and admin's week calendar used to reimplement this
 * independently; see the investigation report). A date is open if EITHER:
 *
 *   - its weekday is template-covered (every occurrence of that weekday counts,
 *     generated or not — a week nobody has generated slots for yet still reads
 *     as open, not shut, or Rania's own unpublished week would look closed), OR
 *   - this exact date carries at least one `published` slot (a one-off outside
 *     the recurring schedule).
 *
 * These are deliberately different granularities and are NOT interchangeable:
 * the template side opens every future occurrence of a weekday, the slot side
 * opens only the single date it was asked about — a one-off on Mon Aug 4 must
 * open that date, not every Monday.
 *
 * The slot side is scoped to `published` only. Nothing ever clears a stale
 * cancelled row, so an "any slot, any status" rule would let a single cancelled
 * leftover permanently and incorrectly keep a day open forever.
 */
export function isDayOpen(
  templates: readonly AvailabilityTemplate[],
  slots: readonly SessionSlot[],
  weekday: Weekday,
  date: CairoDate,
): boolean {
  if (templateCoveredWeekdays(templates).has(weekday)) return true;
  return slots.some((s) => s.status === 'published' && sameCairoDate(s.startsAt, date));
}
