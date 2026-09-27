import type { CreditBatch, Location, LocationId } from '@tpa/types';

/** One branch's worth of something, ready to render as a titled group. */
export interface LocationGroup<T> {
  locationId: LocationId;
  /** Resolved name, or the neutral fallback when the branch row is gone. */
  locationName: string;
  items: T[];
}

/**
 * Group a player's credit batches by the branch they're spendable at.
 *
 * Lives in @tpa/core because BOTH apps show this: the admin in the player detail
 * modal and the player in their wallet. A credit's branch is now part of what the
 * credit IS (065), so the two must never group it differently — the admin telling
 * an owner one thing while the player's wallet says another is exactly the bug
 * that a shared rule prevents.
 *
 * Ordering is deliberate and NOT alphabetical: branches come out in the order
 * `locations` is already in (sort_order, then name), so the grouping reads in the
 * same sequence as every other branch list. A batch whose branch is missing from
 * `locations` still gets a group rather than vanishing — credits you cannot
 * explain are exactly the ones someone needs to see. Within a group the incoming
 * order is preserved, so the caller's sort survives.
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
  for (const [locationId, items] of groups) {
    ordered.push({ locationId, locationName: 'the academy', items });
  }
  return ordered;
}

/**
 * Where a transferred batch came from, as a branch name.
 *
 * "Moved branch" on its own raises exactly the question it should answer, and the
 * parent batch is the only place the answer lives. Returns null for a batch that
 * was not transferred, or whose parent is not in the list.
 */
export function transferredFromName(
  batch: CreditBatch,
  allBatches: readonly CreditBatch[],
  locations: readonly Location[],
): string | null {
  if (batch.source !== 'transfer' || batch.transferredFrom === null) return null;
  const parent = allBatches.find((b) => b.id === batch.transferredFrom);
  if (!parent) return null;
  return locations.find((l) => l.id === parent.locationId)?.name ?? null;
}
