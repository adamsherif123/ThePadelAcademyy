import type { Package } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { packagesAtLocation, packagesByType } from './catalog';

const at = (id: string, locationId: string, over: Partial<Package> = {}): Package => ({
  id: id as Package['id'],
  locationId: locationId as Package['locationId'],
  trainingType: 'group',
  sessionCount: 4,
  price: 100000 as Package['price'],
  name: id,
  isActive: true,
  ...over,
});

describe('packagesAtLocation', () => {
  // The correctness case: a 1.4 client can see EVERY branch's catalog, and a
  // package's credits only work where it was bought. An unfiltered list is a way
  // to buy the wrong thing with nothing on the row to warn you.
  it('shows only the selected branch', () => {
    const out = packagesAtLocation([at('a', 'loc_oro'), at('b', 'loc_qa')], 'loc_oro' as Package['locationId']);
    expect(out.map((p) => p.id)).toEqual(['a']);
  });

  it('still drops hidden packages', () => {
    expect(packagesAtLocation([at('a', 'loc_oro', { isActive: false })], 'loc_oro' as Package['locationId'])).toEqual([]);
  });

  // The instant before locations resolve. Showing nothing beats flashing every
  // branch's catalog for one frame.
  it('shows nothing when the branch is not resolved yet', () => {
    expect(packagesAtLocation([at('a', 'loc_oro')], null)).toEqual([]);
  });

  it('composes with packagesByType', () => {
    const list = [
      at('g', 'loc_oro'),
      at('d', 'loc_oro', { trainingType: 'duo' }),
      at('g2', 'loc_qa'),
    ];
    const scoped = packagesAtLocation(list, 'loc_oro' as Package['locationId']);
    expect(packagesByType(scoped, 'group').map((p) => p.id)).toEqual(['g']);
  });
});

// Home used to read `trialActive` from the WHOLE catalog while showing a
// branch-scoped strip, so a player standing at a branch with no trial was still
// offered "Get your trial session" — for a package sold somewhere else.
describe('the trial offer follows the branch, like every other package', () => {
  const ORO = 'loc_oro' as Package['locationId'];
  const QA = 'loc_qa' as Package['locationId'];
  const trialAtOro = at('pk_trial', 'loc_oro', { trainingType: 'trial' });
  const groupAtQa = at('pk_group_qa', 'loc_qa');

  const trialOffered = (locationId: Package['locationId'] | null) =>
    packagesAtLocation([trialAtOro, groupAtQa], locationId).some((p) => p.trainingType === 'trial');

  it('is offered at the branch that sells it', () => {
    expect(trialOffered(ORO)).toBe(true);
  });

  it('is NOT offered at a branch that does not', () => {
    expect(trialOffered(QA)).toBe(false);
  });

  it('is not offered before a branch has resolved', () => {
    expect(trialOffered(null)).toBe(false);
  });
});
