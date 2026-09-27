import { mockLocations, MOCK_LOCATION_ID } from '@tpa/mocks';
import type { Location, LocationId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// locations.ts imports lib/api → lib/supabase, whose module-load env guard throws
// under the node test env. Only the pure selectors are exercised here (they never
// touch the client), so stub the client module to get past the import guard —
// the same shape coaches.test.ts uses.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import {
  ALL_LOCATIONS,
  creationLocationId,
  defaultLocation,
  locationFilterOptions,
  locationNameById,
  locationsForDisplay,
} from './locations';

const loc = (over: Partial<Location> & Pick<Location, 'id'>): Location => ({
  name: 'Branch',
  address: 'Somewhere',
  mapsUrl: 'https://maps.google.com/?q=x',
  hoursText: 'Daily',
  sortOrder: 0,
  isActive: true,
  isDefault: false,
  createdAt: mockLocations[0]!.createdAt,
  ...over,
});

const A = loc({ id: 'loc_a' as LocationId, name: 'A', isDefault: true });
const B = loc({ id: 'loc_b' as LocationId, name: 'B' });
const CLOSED = loc({ id: 'loc_c' as LocationId, name: 'C', isActive: false });

describe('defaultLocation', () => {
  it('finds the pinned branch', () => {
    expect(defaultLocation([B, A, CLOSED])?.id).toBe('loc_a');
  });

  it('is null when there is no default — never guesses one', () => {
    // A branch being first, or active, does not make it the pin. Only isDefault
    // does, because that is what the database enforces as unique.
    expect(defaultLocation([B, CLOSED])).toBeNull();
    expect(defaultLocation([])).toBeNull();
  });
});

describe('creationLocationId', () => {
  it('prefers the default branch', () => {
    expect(creationLocationId([B, A])).toBe('loc_a');
  });

  it('falls back to the first branch rather than blocking a create', () => {
    // locations is never legitimately empty (061 seeds one and nothing can
    // delete it), but a create must not be impossible if it somehow is.
    expect(creationLocationId([B, CLOSED])).toBe('loc_b');
  });

  it('is null only when there are no branches at all', () => {
    expect(creationLocationId([])).toBeNull();
  });
});

describe('locationsForDisplay', () => {
  it('puts closed branches last without reordering the rest', () => {
    const out = locationsForDisplay([CLOSED, A, B]);
    expect(out.map((l) => l.id)).toEqual(['loc_a', 'loc_b', 'loc_c']);
  });

  it('does not mutate its input', () => {
    const input = [CLOSED, A];
    locationsForDisplay(input);
    expect(input.map((l) => l.id)).toEqual(['loc_c', 'loc_a']);
  });
});

describe('the fixtures agree with migration 061', () => {
  it('ships exactly one branch, and it is the pinned original', () => {
    expect(mockLocations).toHaveLength(1);
    expect(mockLocations[0]!.isDefault).toBe(true);
    expect(mockLocations[0]!.id).toBe(MOCK_LOCATION_ID);
    // The seed id is a literal in the migration; a rename on either side
    // should fail here rather than silently split the two worlds.
    expect(MOCK_LOCATION_ID).toBe('loc_oro_plaza');
  });
});

describe('locationNameById', () => {
  it('resolves a branch to its name', () => {
    expect(locationNameById([A, B], B.id)).toBe('B');
  });

  // Mirrors tpa.location_name's coalesce (068) so the admin and the notification
  // copy never disagree about what an unresolvable branch is called.
  it('falls back to a word, never a raw id — for a missing branch or a null', () => {
    expect(locationNameById([A], B.id)).toBe('the academy');
    expect(locationNameById([A], null)).toBe('the academy');
    expect(locationNameById([A], undefined)).toBe('the academy');
  });
});

describe('locationFilterOptions', () => {
  it('leads with All locations, so the default reads as a choice', () => {
    const opts = locationFilterOptions([A, B]);
    expect(opts[0]).toEqual({ value: ALL_LOCATIONS, label: 'All locations' });
    expect(opts.map((o) => o.value)).toEqual([ALL_LOCATIONS, A.id, B.id]);
  });

  // A closed branch stays filterable: its history did not stop existing.
  it('keeps CLOSED branches and marks them', () => {
    const opts = locationFilterOptions([A, CLOSED]);
    expect(opts.map((o) => o.label)).toEqual(['All locations', 'A', 'C (closed)']);
  });
});
