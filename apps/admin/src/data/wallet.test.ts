import { mockLocations } from '@tpa/mocks';
import type { Location, LocationId, Package, PackageId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { groupPackagesByLocation } from './wallet';

const loc = (id: string, name: string, isActive = true): Location => ({
  id: id as LocationId,
  name,
  address: 'x',
  mapsUrl: 'https://maps.example/x',
  hoursText: 'Daily',
  sortOrder: 0,
  isActive,
  isDefault: false,
  createdAt: mockLocations[0]!.createdAt,
});

const ORO = loc('loc_oro', 'Oro Plaza');
const QA = loc('loc_qa', 'QA Branch');
const SHUT = loc('loc_shut', 'Closed Branch', false);

const pkg = (id: string, locationId: Location['id'], isActive = true): Package => ({
  id: id as PackageId,
  locationId,
  trainingType: 'group',
  sessionCount: 4,
  price: 100000 as Package['price'],
  name: `Pack ${id}`,
  isActive,
});

describe('groupPackagesByLocation', () => {
  it('groups sellable packages by branch', () => {
    const groups = groupPackagesByLocation([pkg('p1', ORO.id), pkg('p2', QA.id)], [ORO, QA]);
    expect(groups.map((g) => [g.locationName, g.items.length])).toEqual([
      ['Oro Plaza', 1],
      ['QA Branch', 1],
    ]);
  });

  it('drops hidden packages — you cannot sell what is not sellable', () => {
    const groups = groupPackagesByLocation([pkg('p1', ORO.id, false)], [ORO]);
    expect(groups).toEqual([]);
  });

  // Unlike the wallet: you cannot take money for a branch that is closed.
  it('drops CLOSED branches entirely', () => {
    const groups = groupPackagesByLocation([pkg('p1', SHUT.id)], [ORO, SHUT]);
    expect(groups).toEqual([]);
  });
});
