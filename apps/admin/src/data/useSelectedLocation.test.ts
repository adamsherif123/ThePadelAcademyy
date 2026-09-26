import type { Location, LocationId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// useSelectedLocation.ts imports data/locations → lib/api → lib/supabase, whose
// module-load env guard throws under the node test env. Only pure functions are
// exercised here; stub the client to get past the import guard (coaches.test.ts
// uses the same shape).
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { activeLocations, resolveSelectedLocation } from './useSelectedLocation';

const loc = (over: Partial<Location> & Pick<Location, 'id'>): Location => ({
  name: 'Branch',
  address: 'Somewhere',
  mapsUrl: 'https://maps.google.com/?q=x',
  hoursText: 'Daily',
  sortOrder: 0,
  isActive: true,
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z' as Location['createdAt'],
  ...over,
});

const ORO = loc({ id: 'loc_oro' as LocationId, name: 'Oro Plaza', isDefault: true, sortOrder: 0 });
const QA = loc({ id: 'loc_qa' as LocationId, name: 'QA Branch', sortOrder: 9 });
const CLOSED = loc({ id: 'loc_shut' as LocationId, name: 'Shut', isActive: false, sortOrder: 1 });
const ALL = [QA, CLOSED, ORO];

describe('activeLocations', () => {
  it('drops inactive branches and orders by sortOrder then name', () => {
    expect(activeLocations(ALL).map((l) => l.id)).toEqual(['loc_oro', 'loc_qa']);
  });
});

describe('resolveSelectedLocation — the ?loc= fallback rule', () => {
  it('honours a valid, active id', () => {
    expect(resolveSelectedLocation(ALL, 'loc_qa')?.id).toBe('loc_qa');
  });

  it('falls back to the default when the param is missing', () => {
    expect(resolveSelectedLocation(ALL, null)?.id).toBe('loc_oro');
  });

  it('falls back when the id is unknown — a stale bookmark still works', () => {
    expect(resolveSelectedLocation(ALL, 'loc_nonsense')?.id).toBe('loc_oro');
  });

  it('falls back when the branch is INACTIVE — a closed branch is never scheduled into', () => {
    // The case that matters most: the id is real, so a naive "does it exist?"
    // check would have accepted it and let the admin schedule into a closed branch.
    expect(resolveSelectedLocation(ALL, 'loc_shut')?.id).toBe('loc_oro');
  });

  it('falls back to the first ACTIVE branch when no default is marked', () => {
    const noDefault = [QA, CLOSED];
    expect(resolveSelectedLocation(noDefault, null)?.id).toBe('loc_qa');
  });

  it('is null only when there is nothing to choose', () => {
    expect(resolveSelectedLocation([], null)).toBeNull();
    expect(resolveSelectedLocation([CLOSED], 'loc_shut')).toBeNull();
  });
});
