import type { IsoInstant, Piastres } from '@tpa/types';

/**
 * A FIXED reference clock for the fixtures. Mocks never read the wall clock, so
 * fixtures are deterministic and reproducible. All relative data (slots "in the
 * next 2 weeks", a batch "expiring in 2 days", an "already expired" batch) is
 * computed from this anchor. The apps should pass MOCK_NOW as `now` to
 * @tpa/core's formatters/predicates so the relative UI is coherent with the data.
 *
 * 2026-07-15T09:00:00Z = Wed 15 Jul 2026, 12:00 Cairo (summer, +03).
 */
export const MOCK_NOW = '2026-07-15T09:00:00.000Z' as IsoInstant;

/** Pounds -> integer piastres, e.g. egp(1600) = 160000 piastres. */
export const egp = (pounds: number): Piastres => (pounds * 100) as Piastres;

/** MOCK_NOW shifted by whole days, as an IsoInstant (for relative fixtures). */
export function daysFromNow(days: number): IsoInstant {
  return new Date(new Date(MOCK_NOW).getTime() + days * 86_400_000).toISOString() as IsoInstant;
}

/** MOCK_NOW shifted by hours, as an IsoInstant (for near-in-time fixtures). */
export function hoursFromNow(hours: number): IsoInstant {
  return new Date(new Date(MOCK_NOW).getTime() + hours * 3_600_000).toISOString() as IsoInstant;
}
