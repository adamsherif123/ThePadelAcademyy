import { groupBatchesByLocation, type LocationGroup } from '@tpa/core';
import type { Location, LocationId, Package } from '@tpa/types';

// Re-exported so existing call sites keep working. The implementation moved to
// @tpa/core (S7) because the player's wallet groups the same way, and the two
// must never disagree about where a credit lives.
export { groupBatchesByLocation };
export type { LocationGroup };

/**
 * The sellable packages at ONE branch, in the order a picker should list them.
 *
 * A cash purchase's branch is not a field the client gets to send: 065 put a
 * before-insert trigger on `purchases` that overwrites location_id from the
 * package, and record_cash_purchase takes no location at all. So "which branch
 * are these credits for" is answered by WHICH PACKAGE you pick, and the only
 * honest way to let an admin choose a branch is to choose the branch first and
 * then show that branch's catalogue.
 *
 * Returns [] for a branch with nothing to sell — a real state, and one the
 * caller has to say out loud rather than render as an empty dropdown.
 */
export function sellablePackagesAt(
  packages: readonly Package[],
  locationId: LocationId | '',
): Package[] {
  if (locationId === '') return [];
  return packages
    .filter((p) => p.isActive && p.locationId === locationId)
    .sort((a, b) => a.trainingType.localeCompare(b.trainingType) || a.sessionCount - b.sessionCount);
}

/**
 * The branch the cash modal should open on.
 *
 * The first active branch that actually has something to sell, so the modal
 * opens on a recordable purchase rather than on an empty catalogue the admin has
 * to click past. Falls back to the first active branch (so the control still has
 * a value, and the empty state explains itself), then to ''.
 */
export function defaultCashLocation(
  packages: readonly Package[],
  locations: readonly Location[],
): LocationId | '' {
  const active = locations.filter((l) => l.isActive);
  const withStock = active.find((l) => packages.some((p) => p.isActive && p.locationId === l.id));
  return withStock?.id ?? active[0]?.id ?? '';
}
