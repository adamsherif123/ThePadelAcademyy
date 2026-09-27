import type { CreditBatch, Location, LocationId, Package } from '@tpa/types';

/** One branch's worth of a player's wallet, ready to render as a titled group. */
export interface LocationGroup<T> {
  locationId: LocationId;
  /** Resolved name, or the neutral fallback when the branch row is gone. */
  locationName: string;
  items: T[];
}

/**
 * Group a player's credit batches by the branch they're spendable at.
 *
 * Ordering is deliberate and NOT alphabetical: branches come out in the order
 * `locations` is already in (sort_order, then name — the same order the Schedule
 * picker uses), so the wallet reads in the same sequence as every other branch
 * list in the app. A batch whose branch is missing from `locations` still gets a
 * group rather than vanishing: credits you cannot explain are exactly the ones an
 * owner needs to see.
 *
 * Within a group the incoming batch order is preserved, so the caller's sort
 * (expiry-first, via batchesForPlayerSorted) survives grouping.
 */
export function groupBatchesByLocation(
  batches: readonly CreditBatch[],
  locations: readonly Location[],
): LocationGroup<CreditBatch>[] {
  const groups = new Map<LocationId, CreditBatch[]>();
  for (const b of batches) {
    const list = groups.get(b.locationId);
    if (list) list.push(b);
    else groups.set(b.locationId, [b]);
  }
  const ordered: LocationGroup<CreditBatch>[] = [];
  for (const loc of locations) {
    const items = groups.get(loc.id);
    if (items) {
      ordered.push({ locationId: loc.id, locationName: loc.name, items });
      groups.delete(loc.id);
    }
  }
  // Anything left references a branch we don't have a row for.
  for (const [locationId, items] of groups) {
    ordered.push({ locationId, locationName: 'the academy', items });
  }
  return ordered;
}

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
