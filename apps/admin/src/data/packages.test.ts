import { mockPackages } from '@tpa/mocks';
import type { TrainingType } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// packages.ts imports lib/api → lib/supabase, whose module-load env guard throws
// under the node test env. These are pure selectors (never touch the client), so
// stub the client module to get past the import guard.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import {
  SELLABLE_TYPES,
  catalogStats,
  packageDescriptor,
  packagesForType,
  perSessionPrice,
  sessionRetailValue,
} from './packages';

/**
 * Package selectors are pure over the fetched catalog. S10b moved the CRUD seam
 * (createPackage/updatePackage/setPackageSellable) to async is_admin-gated writes,
 * proven server-side — so those tests are gone. The S4e repricing regression that
 * used to live here (raise a price, liability unmoved) now lives in dashboard.test
 * against the array-taking creditLiability, which no longer reads packages at all.
 */

describe('trial is sellable (A5 — the one-time discounted trial package)', () => {
  it('SELLABLE_TYPES includes trial alongside the standard types', () => {
    expect(SELLABLE_TYPES).toContain('trial' as TrainingType);
    expect([...SELLABLE_TYPES].sort()).toEqual(['duo', 'group', 'individual', 'trial']);
  });
});

describe('perSessionPrice / packageDescriptor', () => {
  it('per-session price is the round-to-nearest of price ÷ sessions', () => {
    for (const p of mockPackages) {
      expect(perSessionPrice(p)).toBe(Math.round(p.price / p.sessionCount));
    }
  });

  it('descriptor reads "Single X session" for a 1-pack, "N-session X pack" otherwise', () => {
    const single = mockPackages.find((p) => p.sessionCount === 1);
    if (single) expect(packageDescriptor(single)).toBe(`Single ${single.trainingType} session`);
    const bundle = mockPackages.find((p) => p.sessionCount > 1);
    if (bundle) expect(packageDescriptor(bundle)).toBe(`${bundle.sessionCount}-session ${bundle.trainingType} pack`);
  });
});

describe('sessionRetailValue', () => {
  it('is a positive figure for a sold type and null for a type never sold', () => {
    expect(sessionRetailValue(mockPackages, 'group')!).toBeGreaterThan(0);
    // Trial is never an active sellable package, so it has no retail value.
    expect(sessionRetailValue(mockPackages, 'trial')).toBe(null);
  });
});

describe('packagesForType', () => {
  it('returns only that type, cheapest bundle (fewest sessions) first', () => {
    const group = packagesForType(mockPackages, 'group');
    expect(group.length).toBeGreaterThan(0);
    expect(group.every((p) => p.trainingType === 'group')).toBe(true);
    for (let i = 1; i < group.length; i += 1) {
      expect(group[i]!.sessionCount).toBeGreaterThanOrEqual(group[i - 1]!.sessionCount);
    }
  });
});

describe('catalogStats — all derived, never hardcoded', () => {
  it('active count, lowest entry, and best value/session match a manual recompute', () => {
    const active = mockPackages.filter((p) => p.isActive);
    const stats = catalogStats(mockPackages);
    expect(stats.activeCount).toBe(active.length);
    expect(stats.totalCount).toBe(mockPackages.length);
    const cheapest = active.reduce((a, b) => (b.price < a.price ? b : a));
    expect(stats.lowestEntry!.price).toBe(cheapest.price);
    const best = active.reduce((a, b) => (b.price / b.sessionCount < a.price / a.sessionCount ? b : a));
    expect(stats.bestValue!.perSession).toBe(perSessionPrice(best));
  });
});
