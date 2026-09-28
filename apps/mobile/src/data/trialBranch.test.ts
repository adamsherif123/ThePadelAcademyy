import type { Location, LocationId, Package, Piastres } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { defaultTrialBranch, trialBranches, trialPackageAt, trialPriceRange } from './catalog';

const loc = (id: string, name: string, sortOrder: number, isActive = true): Location =>
  ({ id: id as LocationId, name, address: 'a', mapsUrl: 'm', hoursText: 'h', sortOrder, isActive, isDefault: sortOrder === 0 }) as Location;

const pkg = (id: string, locationId: string, over: Partial<Package> = {}): Package => ({
  id: id as Package['id'],
  locationId: locationId as LocationId,
  trainingType: 'trial',
  sessionCount: 1,
  price: 50000 as Piastres,
  name: id,
  isActive: true,
  ...over,
});

const ORO = loc('loc_oro', 'Oro Plaza Hotel', 0);
const QA = loc('loc_qa', 'S7 QA Branch', 97);
const SHUT = loc('loc_shut', 'Closed Branch', 50, false);

describe('trialBranches — active, selling an active trial, in toggle order', () => {
  it('lists the branches that sell one', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_qa', 'loc_qa')];
    expect(trialBranches(packages, [QA, ORO]).map((l) => l.name)).toEqual(['Oro Plaza Hotel', 'S7 QA Branch']);
  });

  // The failure this prevents is a picker entry that cannot work: choosing it
  // would request a package that does not exist and come back package_missing.
  it('excludes a branch with no trial package, however many others it sells', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_qa_group', 'loc_qa', { trainingType: 'group', sessionCount: 4 })];
    expect(trialBranches(packages, [ORO, QA]).map((l) => l.id)).toEqual(['loc_oro']);
  });

  it('excludes a branch whose trial package is inactive', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_qa', 'loc_qa', { isActive: false })];
    expect(trialBranches(packages, [ORO, QA]).map((l) => l.id)).toEqual(['loc_oro']);
  });

  it('excludes an INACTIVE branch even when its trial package is active', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_shut', 'loc_shut')];
    expect(trialBranches(packages, [ORO, SHUT]).map((l) => l.id)).toEqual(['loc_oro']);
  });

  // The hiding rule: one eligible branch means no picker, and the screen is
  // exactly the screen it was before this feature existed.
  it('answers a single branch, which is what hides the picker', () => {
    expect(trialBranches([pkg('pk_oro', 'loc_oro')], [ORO, QA]).length).toBe(1);
  });

  it('answers empty when nothing sells a trial', () => {
    expect(trialBranches([pkg('pk_g', 'loc_oro', { trainingType: 'group' })], [ORO, QA])).toEqual([]);
  });
});

describe('defaultTrialBranch — the player’s current branch, when it qualifies', () => {
  const branches = [ORO, QA];

  it('opens on the branch they are already browsing', () => {
    expect(defaultTrialBranch(branches, 'loc_qa' as LocationId)?.id).toBe('loc_qa');
  });

  // Not the selected branch, because it sells no trial — falling through to the
  // first eligible one is the only answer that produces a working request.
  it('falls back to the first eligible branch when theirs sells no trial', () => {
    expect(defaultTrialBranch([ORO], 'loc_qa' as LocationId)?.id).toBe('loc_oro');
  });

  it('falls back when nothing is selected yet', () => {
    expect(defaultTrialBranch(branches, null)?.id).toBe('loc_oro');
  });

  it('is null when there is nothing to choose', () => {
    expect(defaultTrialBranch([], 'loc_oro' as LocationId)).toBeNull();
  });
});

describe('trialPackageAt', () => {
  it('finds the branch’s own trial, not another branch’s', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_qa', 'loc_qa')];
    expect(trialPackageAt(packages, 'loc_qa' as LocationId)?.id).toBe('pk_qa');
  });

  it('is null for a branch that sells none, and before a branch resolves', () => {
    expect(trialPackageAt([pkg('pk_oro', 'loc_oro')], 'loc_qa' as LocationId)).toBeNull();
    expect(trialPackageAt([pkg('pk_oro', 'loc_oro')], null)).toBeNull();
  });
});

describe('trialPriceRange — what the welcome screen may claim', () => {
  it('states one price flatly when the branches agree', () => {
    const packages = [pkg('pk_oro', 'loc_oro'), pkg('pk_qa', 'loc_qa')];
    expect(trialPriceRange(packages, [ORO, QA])).toEqual({ lowest: 50000, varies: false });
  });

  // Quoting either price as THE price would be wrong for whoever picks the other
  // branch, so the chip has to say "from".
  it('reports the LOWEST and that it varies when they differ', () => {
    const packages = [pkg('pk_oro', 'loc_oro', { price: 60000 as Piastres }), pkg('pk_qa', 'loc_qa', { price: 45000 as Piastres })];
    expect(trialPriceRange(packages, [ORO, QA])).toEqual({ lowest: 45000, varies: true });
  });

  it('ignores a branch that is not eligible, so its price cannot set the floor', () => {
    const packages = [pkg('pk_oro', 'loc_oro', { price: 60000 as Piastres }), pkg('pk_shut', 'loc_shut', { price: 10000 as Piastres })];
    expect(trialPriceRange(packages, [ORO, SHUT])).toEqual({ lowest: 60000, varies: false });
  });

  it('is null when no branch sells a trial', () => {
    expect(trialPriceRange([], [ORO, QA])).toBeNull();
  });
});
