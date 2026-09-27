import { groupBatchesByLocation, type LocationGroup } from '@tpa/core';
import type { Location, Package } from '@tpa/types';

// Re-exported so existing call sites keep working. The implementation moved to
// @tpa/core (S7) because the player's wallet groups the same way, and the two
// must never disagree about where a credit lives.
export { groupBatchesByLocation };
export type { LocationGroup };

/**
 * The same grouping for the cash-purchase picker. Only ACTIVE branches and only
 * sellable packages can be sold, so a closed branch's catalog never appears —
 * unlike the wallet, where history must stay visible.
 */
export function groupPackagesByLocation(
  packages: readonly Package[],
  locations: readonly Location[],
): LocationGroup<Package>[] {
  const sellable = packages.filter((p) => p.isActive);
  const out: LocationGroup<Package>[] = [];
  for (const loc of locations) {
    if (!loc.isActive) continue;
    const items = sellable.filter((p) => p.locationId === loc.id);
    if (items.length > 0) out.push({ locationId: loc.id, locationName: loc.name, items });
  }
  return out;
}
