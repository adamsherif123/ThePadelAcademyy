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
