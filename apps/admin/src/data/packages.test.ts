import { MOCK_NOW } from '@tpa/mocks';
import type { PackageId, Piastres, TrainingType } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { creditLiability } from './dashboard';
import {
  SELLABLE_TYPES,
  catalogStats,
  createPackage,
  perSessionPrice,
  setPackageSellable,
  updatePackage,
} from './packages';
import { __resetStoreForTests, getPackages } from './store';

beforeEach(() => __resetStoreForTests());

const GROUP_8 = 'pk_group_8' as PackageId;
const draftFrom = (id: PackageId) => {
  const p = getPackages().find((x) => x.id === id)!;
  return { trainingType: p.trainingType, sessionCount: p.sessionCount, price: p.price, name: p.name, isActive: p.isActive };
};

describe('trial is structurally unsellable', () => {
  it('SELLABLE_TYPES never includes trial', () => {
    expect(SELLABLE_TYPES).not.toContain('trial' as TrainingType);
    expect([...SELLABLE_TYPES].sort()).toEqual(['duo', 'group', 'individual']);
  });

  it('createPackage rejects a trial package as a backstop', () => {
    const res = createPackage({ trainingType: 'trial', sessionCount: 1, price: 50000 as Piastres, name: 'Trial', isActive: true });
    expect(res.ok ? null : res.reason).toBe('trial_not_sellable');
  });
});

describe('createPackage / updatePackage validation', () => {
  it('rejects empty name, sub-1 sessions, sub-1 price', () => {
    const noName = createPackage({ trainingType: 'group', sessionCount: 4, price: 100000 as Piastres, name: '  ', isActive: true });
    expect(noName.ok ? null : noName.reason).toBe('name_required');
    const noSessions = createPackage({ trainingType: 'group', sessionCount: 0, price: 100000 as Piastres, name: 'X', isActive: true });
    expect(noSessions.ok ? null : noSessions.reason).toBe('sessions_below_one');
    const noPrice = createPackage({ trainingType: 'group', sessionCount: 4, price: 0 as Piastres, name: 'X', isActive: true });
    expect(noPrice.ok ? null : noPrice.reason).toBe('price_below_one');
  });

  it('edit locks the bundle identity — trainingType + sessionCount can’t change', () => {
    const res = updatePackage(GROUP_8, { trainingType: 'individual', sessionCount: 999, price: 300000 as Piastres, name: 'Renamed', isActive: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pkg.trainingType).toBe('group'); // ignored the draft
    expect(res.pkg.sessionCount).toBe(8); // ignored the draft
    expect(res.pkg.price).toBe(300000); // applied
    expect(res.pkg.name).toBe('Renamed');
  });
});

describe('catalogStats — all derived, never hardcoded', () => {
  it('active count, lowest entry, and best value/session match a manual recompute', () => {
    const active = getPackages().filter((p) => p.isActive);
    const stats = catalogStats();
    expect(stats.activeCount).toBe(active.length);
    expect(stats.totalCount).toBe(getPackages().length);
    const cheapest = active.reduce((a, b) => (b.price < a.price ? b : a));
    expect(stats.lowestEntry!.price).toBe(cheapest.price);
    const best = active.reduce((a, b) => (b.price / b.sessionCount < a.price / a.sessionCount ? b : a));
    expect(stats.bestValue!.perSession).toBe(perSessionPrice(best));
  });
});

describe('THE money bug: repricing must not move liability for already-sold credits', () => {
  it('raising the Group 8-pack price leaves existing credit liability unchanged', () => {
    const before = creditLiability(MOCK_NOW);
    expect(before).toBeGreaterThan(0);

    // Raise 2,800 → 3,200 EGP, exactly the brief's scenario.
    const res = updatePackage(GROUP_8, { ...draftFrom(GROUP_8), price: 320000 as Piastres });
    expect(res.ok).toBe(true);
    expect(getPackages().find((p) => p.id === GROUP_8)!.price).toBe(320000); // reprice really applied

    expect(creditLiability(MOCK_NOW)).toBe(before); // ...but liability did NOT budge
  });

  it('hiding a package does not affect credits already sold', () => {
    const before = creditLiability(MOCK_NOW);
    setPackageSellable(GROUP_8, false);
    expect(getPackages().find((p) => p.id === GROUP_8)!.isActive).toBe(false);
    expect(creditLiability(MOCK_NOW)).toBe(before);
  });
});
