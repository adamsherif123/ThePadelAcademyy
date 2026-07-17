import type { IsoInstant, Piastres } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  formatCompactEgp,
  formatDayMonth,
  formatExpiry,
  formatHour,
  formatInstantDate,
  formatInstantTime,
  formatMonthDay,
  formatPiastres,
  formatSessionTimeRange,
} from './format';

const egp = (n: number) => (n * 100) as Piastres;

describe('formatCompactEgp', () => {
  it('drops the decimal for whole thousands and keeps one otherwise', () => {
    expect(formatCompactEgp(egp(80000))).toBe('80k'); // 80,000 EGP
    expect(formatCompactEgp(egp(512700))).toBe('512.7k');
    expect(formatCompactEgp(egp(1_200_000))).toBe('1.2M');
    expect(formatCompactEgp(egp(750))).toBe('750');
    expect(formatCompactEgp(egp(0))).toBe('0');
  });
});

describe('formatHour', () => {
  it('renders the Cairo hour without minutes', () => {
    expect(formatHour('2026-07-19T15:00:00.000Z' as IsoInstant)).toBe('6 PM'); // 18:00 Cairo
    expect(formatHour('2026-07-19T09:00:00.000Z' as IsoInstant)).toBe('12 PM'); // noon Cairo
  });
});

describe('formatMonthDay', () => {
  it('renders compact Cairo "Mon D"', () => {
    expect(formatMonthDay('2026-07-19T09:00:00.000Z' as IsoInstant)).toBe('Jul 19');
    // Cairo rollover: 22:00Z on 30 Jun is 01:00 Cairo on 1 Jul.
    expect(formatMonthDay('2026-06-30T22:00:00.000Z' as IsoInstant)).toBe('Jul 1');
  });
});

describe('formatDayMonth', () => {
  it('renders compact Cairo day/month without leading zeros', () => {
    // 2026-05-30T22:00Z is 2026-05-31 01:00 Cairo (+03) → "31/5", not "30/5".
    expect(formatDayMonth('2026-05-30T22:00:00.000Z' as IsoInstant)).toBe('31/5');
    expect(formatDayMonth('2026-07-05T09:00:00.000Z' as IsoInstant)).toBe('5/7');
  });
});

describe('formatPiastres', () => {
  it('formats whole pounds with grouping and no decimals', () => {
    expect(formatPiastres(egp(1600))).toBe('1,600 EGP');
    expect(formatPiastres(egp(500))).toBe('500 EGP');
    expect(formatPiastres(egp(6000))).toBe('6,000 EGP');
    expect(formatPiastres(0 as Piastres)).toBe('0 EGP');
  });

  it('shows two decimals only when there is a piastres remainder', () => {
    expect(formatPiastres(55050 as Piastres)).toBe('550.50 EGP');
    expect(formatPiastres(1 as Piastres)).toBe('0.01 EGP');
  });
});

describe('date/time formatting (Africa/Cairo)', () => {
  // 15:00Z on 14 Jul 2026 (summer, +03) is 18:00 in Cairo.
  const startsAt = '2026-07-14T15:00:00.000Z' as IsoInstant;
  const endsAt = '2026-07-14T16:00:00.000Z' as IsoInstant;

  it('renders the Cairo date', () => {
    expect(formatInstantDate(startsAt)).toBe('Tue 14 Jul');
  });

  it('renders the Cairo wall-clock time', () => {
    expect(formatInstantTime(startsAt)).toBe('6:00 PM');
    expect(formatInstantTime(endsAt)).toBe('7:00 PM');
  });

  it('renders a session range', () => {
    expect(formatSessionTimeRange(startsAt, endsAt)).toBe('Tue 14 Jul · 6:00 PM – 7:00 PM');
  });
});

describe('formatExpiry', () => {
  const now = '2026-07-14T12:00:00.000Z' as IsoInstant;

  it('reports how long ago a past instant expired, by Cairo calendar day', () => {
    // Earlier same Cairo day (both 14 Jul in Cairo, +03).
    expect(formatExpiry('2026-07-14T11:59:59.000Z' as IsoInstant, now)).toBe('expired today');
    // 13 Jul vs 14 Jul in Cairo.
    expect(formatExpiry('2026-07-13T09:00:00.000Z' as IsoInstant, now)).toBe('expired yesterday');
    expect(formatExpiry('2026-06-01T00:00:00.000Z' as IsoInstant, now)).toBe('expired 43 days ago');
  });

  it('reports today / tomorrow / in n days by Cairo calendar day', () => {
    expect(formatExpiry('2026-07-14T20:00:00.000Z' as IsoInstant, now)).toBe('expires today');
    expect(formatExpiry('2026-07-15T20:00:00.000Z' as IsoInstant, now)).toBe('expires tomorrow');
    expect(formatExpiry('2026-07-17T09:00:00.000Z' as IsoInstant, now)).toBe('expires in 3 days');
  });
});
