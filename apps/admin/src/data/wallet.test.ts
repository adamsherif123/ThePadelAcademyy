import { mockLocations } from '@tpa/mocks';
import type { Location, LocationId, Package, PackageId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { defaultCashLocation, sellablePackagesAt } from './wallet';

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

describe('sellablePackagesAt', () => {
  const oro4 = { ...pkg('oro4', ORO.id), trainingType: 'group' as const, sessionCount: 4 };
  const oro1 = { ...pkg('oro1', ORO.id), trainingType: 'group' as const, sessionCount: 1 };
  const oroDuo = { ...pkg('oroDuo', ORO.id), trainingType: 'duo' as const, sessionCount: 8 };
  const qa1 = pkg('qa1', QA.id);
  const retired = pkg('oroOld', ORO.id, false);
  const all = [oro4, oro1, oroDuo, qa1, retired];

  it('returns only the branch asked for', () => {
    expect(sellablePackagesAt(all, ORO.id).map((p) => p.id)).toEqual(['oroDuo', 'oro1', 'oro4']);
    expect(sellablePackagesAt(all, QA.id).map((p) => p.id)).toEqual(['qa1']);
  });

  it('never leaks another branch in — the whole point of the control', () => {
    // The bug this replaces: the picker listed every branch's packages at once,
    // so the branch a purchase landed at was a side effect of which row you
    // happened to click.
    for (const id of [ORO.id, QA.id]) {
      expect(sellablePackagesAt(all, id).every((p) => p.locationId === id)).toBe(true);
    }
  });

  it('excludes retired packages', () => {
    expect(sellablePackagesAt(all, ORO.id).map((p) => p.id)).not.toContain('oroOld');
  });

  it('sorts by training type then session count, as the picker lists them', () => {
    expect(sellablePackagesAt(all, ORO.id).map((p) => `${p.trainingType}/${p.sessionCount}`)).toEqual([
      'duo/8',
      'group/1',
      'group/4',
    ]);
  });

  it('is empty for a branch with nothing to sell, and for no branch at all', () => {
    expect(sellablePackagesAt(all, SHUT.id)).toEqual([]);
    expect(sellablePackagesAt(all, '')).toEqual([]);
  });
});

describe('defaultCashLocation', () => {
  it('opens on the first active branch that has something to sell', () => {
    // QA is listed first but is empty, so the modal must not open on it and
    // present an admin with an empty catalogue to click past.
    expect(defaultCashLocation([pkg('p1', ORO.id)], [QA, ORO])).toBe(ORO.id);
  });

  it('skips a closed branch even when it has packages', () => {
    expect(defaultCashLocation([pkg('p1', SHUT.id), pkg('p2', ORO.id)], [SHUT, ORO])).toBe(ORO.id);
  });

  it('skips a branch whose only packages are retired', () => {
    expect(defaultCashLocation([pkg('p1', QA.id, false), pkg('p2', ORO.id)], [QA, ORO])).toBe(ORO.id);
  });

  it('still names an active branch when nothing is sellable anywhere', () => {
    // The control needs a value or it renders blank; the empty state then
    // explains that the branch has no packages yet.
    expect(defaultCashLocation([], [QA, ORO])).toBe(QA.id);
  });

  it("is '' when there is no active branch at all", () => {
    expect(defaultCashLocation([], [SHUT])).toBe('');
    expect(defaultCashLocation([], [])).toBe('');
  });
});

