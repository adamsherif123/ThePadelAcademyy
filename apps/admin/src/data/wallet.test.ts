import { mockLocations } from '@tpa/mocks';
import type { CreditBatch, IsoInstant, Location, LocationId, Package, PackageId, PlayerId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { groupBatchesByLocation, groupPackagesByLocation } from './wallet';

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

const batch = (id: string, locationId: Location['id']): CreditBatch => ({
  id: id as CreditBatch['id'],
  locationId,
  playerId: 'pl_1' as PlayerId,
  source: 'admin_grant',
  purchaseId: null,
  transferredFrom: null,
  trainingType: 'group',
  quantityTotal: 4,
  quantityRemaining: 2,
  expiresAt: '2026-12-01T00:00:00.000Z' as IsoInstant,
  createdAt: '2026-09-01T00:00:00.000Z' as IsoInstant,
  note: null,
});

const pkg = (id: string, locationId: Location['id'], isActive = true): Package => ({
  id: id as PackageId,
  locationId,
  trainingType: 'group',
  sessionCount: 4,
  price: 100000 as Package['price'],
  name: `Pack ${id}`,
  isActive,
});

describe('groupBatchesByLocation', () => {
  it('groups in the order `locations` is already in, not alphabetically', () => {
    const groups = groupBatchesByLocation([batch('b1', QA.id), batch('b2', ORO.id)], [ORO, QA]);
    expect(groups.map((g) => g.locationName)).toEqual(['Oro Plaza', 'QA Branch']);
  });

  it('preserves the caller’s sort within a group', () => {
    const groups = groupBatchesByLocation([batch('b1', ORO.id), batch('b2', ORO.id)], [ORO]);
    expect(groups[0]!.items.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('omits a branch the player holds nothing at', () => {
    const groups = groupBatchesByLocation([batch('b1', ORO.id)], [ORO, QA]);
    expect(groups).toHaveLength(1);
  });

  // Credits you cannot explain are exactly the ones an owner needs to see, so an
  // unresolvable branch gets a group rather than dropping the batch silently.
  it('still shows a batch whose branch is missing from `locations`', () => {
    const groups = groupBatchesByLocation([batch('b1', 'loc_gone' as LocationId)], [ORO]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.locationName).toBe('the academy');
    expect(groups[0]!.items).toHaveLength(1);
  });

  it('keeps CLOSED branches — history does not stop existing', () => {
    const groups = groupBatchesByLocation([batch('b1', SHUT.id)], [ORO, SHUT]);
    expect(groups.map((g) => g.locationName)).toEqual(['Closed Branch']);
  });
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
