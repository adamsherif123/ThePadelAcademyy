import type { Location, LocationId } from '@tpa/types';

import { MOCK_NOW } from './now';

/**
 * The original branch, matching migration 061's seed row exactly — same id, same
 * four facts. Every other fixture sits at this location: the fixtures describe
 * the academy as it is today, which is one branch with everything in it.
 *
 * A second branch is deliberately NOT mocked. Nothing in either app filters by
 * location yet (that lands with 1.4), so a second row would only give the
 * fixtures a dimension the code under test cannot exercise — and the first thing
 * it would do is make every "all slots" count in the existing tests ambiguous.
 */
export const MOCK_LOCATION_ID = 'loc_oro_plaza' as LocationId;

export const mockLocations: Location[] = [
  {
    id: MOCK_LOCATION_ID,
    name: 'Oro Plaza Hotel',
    address: 'In front of Family Park, Cairo',
    mapsUrl: 'https://maps.google.com/?q=Oro+Plaza+Hotel+Rehab+Cairo',
    hoursText: 'Sun – Wed · 5:00 PM – 11:00 PM',
    sortOrder: 0,
    isActive: true,
    isDefault: true,
    createdAt: MOCK_NOW,
  },
];

/**
 * Stamps a fixture row with the default branch.
 *
 * The literal arrays below are written WITHOUT locationId and typed
 * `Omit<T, 'locationId'>[]`, then mapped through this. Adding the same
 * `locationId: MOCK_LOCATION_ID` to ~40 one-line literals would bury the fields
 * that actually differ between fixtures in noise, and the next column added to
 * these tables would mean touching every line again.
 */
export const atDefaultLocation = <T extends object>(row: T): T & { locationId: LocationId } => ({
  ...row,
  locationId: MOCK_LOCATION_ID,
});
