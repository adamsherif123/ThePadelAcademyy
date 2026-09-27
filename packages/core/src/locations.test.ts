import type { CreditBatch, CreditBatchId, IsoInstant, Location, LocationId, PlayerId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { groupBatchesByLocation, transferredFromName } from './locations';

const loc = (id: string, name: string, isActive = true): Location => ({
  id: id as LocationId,
  name,
  address: 'x',
  mapsUrl: 'https://maps.example/x',
  hoursText: 'Daily',
  sortOrder: 0,
  isActive,
  isDefault: false,
  createdAt: '2026-09-01T00:00:00.000Z' as IsoInstant,
});

const ORO = loc('loc_oro', 'Oro Plaza');
const QA = loc('loc_qa', 'QA Branch');
const SHUT = loc('loc_shut', 'Closed Branch', false);

const batch = (id: string, locationId: Location['id'], over: Partial<CreditBatch> = {}): CreditBatch => ({
  id: id as CreditBatchId,
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
  ...over,
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


describe('transferredFromName', () => {
  const parent = batch('cb_parent', ORO.id);
  const child = batch('cb_child', QA.id, { source: 'transfer', transferredFrom: parent.id });

  it('names the branch a transfer came from', () => {
    expect(transferredFromName(child, [parent, child], [ORO, QA])).toBe('Oro Plaza');
  });

  it('is null for a batch that was never moved', () => {
    expect(transferredFromName(parent, [parent], [ORO])).toBeNull();
  });

  // Both are real: a parent deleted by an owner, or a branch closed and removed
  // from the list. Neither should render "Moved from undefined".
  it('is null when the parent batch is not in hand', () => {
    expect(transferredFromName(child, [child], [ORO, QA])).toBeNull();
  });

  it('is null when the parent branch is unknown', () => {
    expect(transferredFromName(child, [parent, child], [QA])).toBeNull();
  });
});
