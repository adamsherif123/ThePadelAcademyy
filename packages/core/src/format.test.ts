import type { IsoInstant, Piastres } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  formatExpiry,
  formatInstantDate,
  formatInstantTime,
  formatPiastres,
  formatSessionTimeRange,
} from './format';

const egp = (n: number) => (n * 100) as Piastres;

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

  it('reports expired for a past instant', () => {
    expect(formatExpiry('2026-07-14T11:59:59.000Z' as IsoInstant, now)).toBe('expired');
    expect(formatExpiry('2026-06-01T00:00:00.000Z' as IsoInstant, now)).toBe('expired');
  });

  it('reports today / tomorrow / in n days by Cairo calendar day', () => {
    expect(formatExpiry('2026-07-14T20:00:00.000Z' as IsoInstant, now)).toBe('expires today');
    expect(formatExpiry('2026-07-15T20:00:00.000Z' as IsoInstant, now)).toBe('expires tomorrow');
    expect(formatExpiry('2026-07-17T09:00:00.000Z' as IsoInstant, now)).toBe('expires in 3 days');
  });
});
