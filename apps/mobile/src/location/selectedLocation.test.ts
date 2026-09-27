import type { Location, LocationId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// AsyncStorage drags in react-native, which the node test runner cannot parse.
// Only the pure resolvers are exercised here. The mock has to be hoisted ABOVE
// the import it stubs, which is exactly what import/first objects to.
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));

// eslint-disable-next-line import/first
import { resolveSelectedLocation, shouldShowToggle, toggleOptions } from './selectedLocation';

const loc = (over: Partial<Location> & Pick<Location, 'id'>): Location => ({
  name: 'Branch',
  address: 'x',
  mapsUrl: 'https://maps.example/x',
  hoursText: 'Daily 9\u201311',
  sortOrder: 0,
  isActive: true,
  isDefault: false,
  createdAt: '2026-09-01T00:00:00.000Z' as Location['createdAt'],
  ...over,
});

const ORO = loc({ id: 'loc_oro' as LocationId, name: 'Oro Plaza', isDefault: true, sortOrder: 0 });
const QA = loc({ id: 'loc_qa' as LocationId, name: 'QA Branch', sortOrder: 1 });
const SHUT = loc({ id: 'loc_shut' as LocationId, name: 'Closed', isActive: false, sortOrder: 2 });

describe('resolveSelectedLocation', () => {
  it('honours a stored, active branch', () => {
    expect(resolveSelectedLocation([ORO, QA], QA.id)?.id).toBe(QA.id);
  });

  it('falls back to the default when nothing is stored (first launch)', () => {
    expect(resolveSelectedLocation([ORO, QA], null)?.id).toBe(ORO.id);
  });

  it('falls back when the stored branch no longer exists', () => {
    expect(resolveSelectedLocation([ORO], QA.id)?.id).toBe(ORO.id);
  });

  // The case that matters most: a branch closing while the app was shut would
  // otherwise restore an empty screen with no explanation.
  it('refuses a stored branch that has since gone INACTIVE', () => {
    expect(resolveSelectedLocation([ORO, SHUT], SHUT.id)?.id).toBe(ORO.id);
  });

  it('falls back to the first active branch when none is flagged default', () => {
    expect(resolveSelectedLocation([QA, SHUT], null)?.id).toBe(QA.id);
  });

  it('is null when there is nothing active at all, rather than throwing', () => {
    expect(resolveSelectedLocation([SHUT], SHUT.id)).toBeNull();
    expect(resolveSelectedLocation([], null)).toBeNull();
  });
});

describe('toggleOptions', () => {
  it('lists active branches by sort_order', () => {
    const out = toggleOptions([QA, ORO, SHUT]);
    expect(out.map((l) => l.id)).toEqual([ORO.id, QA.id]);
  });

  it('breaks a sort_order tie by name', () => {
    const b = loc({ id: 'loc_b' as LocationId, name: 'Bravo', sortOrder: 5 });
    const a = loc({ id: 'loc_a' as LocationId, name: 'Alpha', sortOrder: 5 });
    expect(toggleOptions([b, a]).map((l) => l.name)).toEqual(['Alpha', 'Bravo']);
  });
});

describe('shouldShowToggle', () => {
  // 1.4 ships before the second branch opens; the app must look like 1.3 until
  // there is a real choice.
  it('is hidden with one active branch', () => {
    expect(shouldShowToggle([ORO])).toBe(false);
    expect(shouldShowToggle([ORO, SHUT])).toBe(false);
  });

  it('appears as soon as a second branch opens', () => {
    expect(shouldShowToggle([ORO, QA])).toBe(true);
  });

  it('is hidden when there are no branches at all', () => {
    expect(shouldShowToggle([])).toBe(false);
  });
});
