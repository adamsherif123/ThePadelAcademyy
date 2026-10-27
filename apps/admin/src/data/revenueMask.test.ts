import { formatCompactEgp, formatPiastres } from '@tpa/core';
import type { Piastres } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  MASKED_COMPACT,
  MASKED_EGP,
  REVENUE_REVEALED_KEY,
  readRevenueRevealed,
  revenueAmount,
  revenueCompact,
  writeRevenueRevealed,
} from './revenueMask';

const egp = (n: number) => (n * 100) as Piastres;

/** An in-memory sessionStorage stand-in. */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('revenueAmount / revenueCompact', () => {
  it('shows the real figure only when revealed', () => {
    expect(revenueAmount(egp(113_700), true)).toBe(formatPiastres(egp(113_700)));
    expect(revenueCompact(egp(80_000), true)).toBe(formatCompactEgp(egp(80_000)));
  });

  it('masks when hidden, with no digit left in the output', () => {
    expect(revenueAmount(egp(113_700), false)).toBe(MASKED_EGP);
    expect(revenueCompact(egp(80_000), false)).toBe(MASKED_COMPACT);
    expect(MASKED_EGP).not.toMatch(/\d/);
    expect(MASKED_COMPACT).not.toMatch(/\d/);
  });

  it('is the same width for every amount, so the mask does not leak the magnitude', () => {
    const amounts = [0, 900, 113_700, 2_400_000].map(egp);
    expect(new Set(amounts.map((a) => revenueAmount(a, false))).size).toBe(1);
    expect(new Set(amounts.map((a) => revenueCompact(a, false))).size).toBe(1);
  });

  it('keeps the currency so the hidden card still reads as money', () => {
    expect(MASKED_EGP.endsWith(' EGP')).toBe(true);
  });
});

describe('readRevenueRevealed: hidden unless this tab said otherwise', () => {
  it('is hidden on a fresh tab (nothing stored)', () => {
    expect(readRevenueRevealed(() => memoryStore())).toBe(false);
  });

  it('is hidden with no storage at all (no window, as in this node test run)', () => {
    expect(readRevenueRevealed(() => undefined)).toBe(false);
    expect(readRevenueRevealed()).toBe(false);
  });

  it('is hidden when reading storage throws, or when even reaching it throws', () => {
    expect(readRevenueRevealed(() => throwing)).toBe(false);
    expect(
      readRevenueRevealed(() => {
        throw new Error('SecurityError');
      }),
    ).toBe(false);
  });

  it('is hidden for any value it did not write', () => {
    for (const v of ['0', 'true', 'yes', '', ' 1']) {
      expect(readRevenueRevealed(() => memoryStore({ [REVENUE_REVEALED_KEY]: v }))).toBe(false);
    }
  });

  it('is revealed only after this tab revealed it', () => {
    expect(readRevenueRevealed(() => memoryStore({ [REVENUE_REVEALED_KEY]: '1' }))).toBe(true);
  });
});

describe('writeRevenueRevealed', () => {
  it('round-trips Show and Hide through the store', () => {
    const store = memoryStore();
    writeRevenueRevealed(true, () => store);
    expect(readRevenueRevealed(() => store)).toBe(true);
    writeRevenueRevealed(false, () => store);
    expect(readRevenueRevealed(() => store)).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    expect(() => writeRevenueRevealed(true, () => throwing)).not.toThrow();
    expect(() => writeRevenueRevealed(true, () => undefined)).not.toThrow();
    expect(() => writeRevenueRevealed(true)).not.toThrow();
  });
});
