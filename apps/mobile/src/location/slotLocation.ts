import type { Location, LocationId } from '@tpa/types';

import { ACADEMY } from '../ui/academy';

/** The three location facts a session screen shows: what to call it, and where. */
export interface PlaceFacts {
  name: string;
  /** The one-line "Name · City" used on cards. */
  line: string;
  mapsUrl: string;
}

/**
 * Where a session actually is.
 *
 * Before branches there was one answer (the ACADEMY constant) and every screen
 * hard-coded it. Now a session's place comes from ITS OWN branch — not from the
 * toggle, which is only about what you are browsing. Showing the selected branch
 * on a booking at another one would send a player to the wrong address, which is
 * the worst failure this feature can produce.
 *
 * ACADEMY remains the fallback for the instant before locations load and for a
 * branch row that has gone missing: the original club's details are the right
 * guess when we have nothing better, and a card with no address is worse than a
 * card with the main one.
 */
export function placeFor(
  locationId: LocationId | null | undefined,
  locations: readonly Location[],
): PlaceFacts {
  const found = locationId == null ? undefined : locations.find((l) => l.id === locationId);
  // The line is BUILT here too, not taken from ACADEMY.locationLine (a shorter
  // marketing string used signed-out): a card must not change shape the moment
  // locations finish loading.
  if (!found) {
    return {
      name: ACADEMY.name,
      line: `${ACADEMY.name} · ${ACADEMY.address}`,
      mapsUrl: ACADEMY.mapsUrl,
    };
  }
  return {
    name: found.name,
    // Built rather than stored: `address` is the full line the admin typed, and
    // repeating the branch name in front of it is how every card already reads.
    line: `${found.name} · ${found.address}`,
    mapsUrl: found.mapsUrl,
  };
}
