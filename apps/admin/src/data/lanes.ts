export interface Interval {
  startMs: number;
  endMs: number;
}

export interface LanePlacement<T> {
  item: T;
  /** 0-based lane WITHIN the event's overlap cluster. */
  lane: number;
  /** Number of lanes in that cluster — the event's width is 1 / lanes. */
  lanes: number;
}

/**
 * Assign side-by-side lanes to time intervals so concurrent events never overlap
 * visually (the calendar problem v0 shipped broken). Pure and O(n log n):
 *
 *  1. Group events into CONNECTED overlap clusters — A∼B and B∼C put A, B, C in one
 *     cluster even when A and C don't touch (grown via a running cluster max-end).
 *  2. Within a cluster, greedily give each event the first lane whose previous
 *     event has already ENDED; else open a new lane.
 *  3. Width = 1 / (lanes in THAT cluster) — per cluster, not per day, so a 4-way
 *     6 PM pile-up doesn't shrink a lone 9 PM event.
 *
 * Overlap is strict: touching at a boundary (6–8 and 8–10) is NOT an overlap, so
 * back-to-back sessions share a lane at full width. Results come back in input
 * order.
 */
export function assignLanes<T>(
  items: readonly T[],
  toInterval: (item: T) => Interval,
): LanePlacement<T>[] {
  const indexed = items.map((item, index) => ({ item, index, ...toInterval(item) }));
  indexed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const result: LanePlacement<T>[] = new Array(items.length);

  let i = 0;
  while (i < indexed.length) {
    // Grow one connected cluster: keep pulling in the next event while it starts
    // BEFORE the cluster's running max-end (i.e. it overlaps something inside).
    let clusterMaxEnd = indexed[i]!.endMs;
    let j = i + 1;
    while (j < indexed.length && indexed[j]!.startMs < clusterMaxEnd) {
      clusterMaxEnd = Math.max(clusterMaxEnd, indexed[j]!.endMs);
      j += 1;
    }
    const cluster = indexed.slice(i, j);

    // Greedy lane assignment; laneEnds[l] = end time of the last event in lane l.
    const laneEnds: number[] = [];
    for (const ev of cluster) {
      let lane = laneEnds.findIndex((end) => end <= ev.startMs);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.endMs);
      } else {
        laneEnds[lane] = ev.endMs;
      }
      result[ev.index] = { item: ev.item, lane, lanes: 0 };
    }
    // Width is per cluster: backfill the cluster's lane count now it's known.
    const lanes = laneEnds.length;
    for (const ev of cluster) result[ev.index]!.lanes = lanes;

    i = j;
  }

  return result;
}
