import { describe, expect, it } from 'vitest';

import { assignLanes } from './lanes';

interface Ev {
  id: string;
  s: number;
  e: number;
}
const place = (items: Ev[]) => {
  const r = assignLanes(items, (x) => ({ startMs: x.s, endMs: x.e }));
  return Object.fromEntries(r.map((p) => [(p.item as Ev).id, p]));
};

describe('assignLanes', () => {
  it('two overlapping → 2 lanes, distinct lane indices', () => {
    const by = place([
      { id: 'a', s: 0, e: 2 },
      { id: 'b', s: 1, e: 3 },
    ]);
    expect([by.a!.lanes, by.b!.lanes]).toEqual([2, 2]);
    expect(new Set([by.a!.lane, by.b!.lane])).toEqual(new Set([0, 1]));
  });

  it('three mutually overlapping → 3 lanes', () => {
    const by = place([
      { id: 'a', s: 0, e: 3 },
      { id: 'b', s: 1, e: 4 },
      { id: 'c', s: 2, e: 5 },
    ]);
    expect([by.a!.lanes, by.b!.lanes, by.c!.lanes]).toEqual([3, 3, 3]);
    expect(new Set([by.a!.lane, by.b!.lane, by.c!.lane])).toEqual(new Set([0, 1, 2]));
  });

  it('A–B–C chain: A∼B, B∼C, A≁C share one cluster; C reuses A’s lane (2 lanes)', () => {
    const by = place([
      { id: 'a', s: 0, e: 3 },
      { id: 'b', s: 1, e: 4 },
      { id: 'c', s: 3.5, e: 5 },
    ]);
    expect([by.a!.lanes, by.b!.lanes, by.c!.lanes]).toEqual([2, 2, 2]);
    expect(by.a!.lane).toBe(0);
    expect(by.b!.lane).toBe(1);
    expect(by.c!.lane).toBe(0); // A has ended by 3.5, so C reuses lane 0
  });

  it('identical start/end → 2 lanes side by side', () => {
    const by = place([
      { id: 'a', s: 0, e: 2 },
      { id: 'b', s: 0, e: 2 },
    ]);
    expect([by.a!.lanes, by.b!.lanes]).toEqual([2, 2]);
    expect(new Set([by.a!.lane, by.b!.lane])).toEqual(new Set([0, 1]));
  });

  it('THE edge: 6–8 and 8–10 touch but do NOT overlap → separate clusters, full width', () => {
    const by = place([
      { id: 'early', s: 6, e: 8 },
      { id: 'late', s: 8, e: 10 },
    ]);
    expect([by.early!.lanes, by.late!.lanes]).toEqual([1, 1]);
    expect([by.early!.lane, by.late!.lane]).toEqual([0, 0]);
  });

  it('width is PER cluster: a 4-way 6 PM pile-up does not shrink a lone 9 PM event', () => {
    const by = place([
      { id: 'a', s: 6, e: 8 },
      { id: 'b', s: 6, e: 8 },
      { id: 'c', s: 6, e: 8 },
      { id: 'd', s: 6, e: 8 },
      { id: 'x', s: 9, e: 10 },
    ]);
    expect(by.a!.lanes).toBe(4);
    expect(by.x!.lanes).toBe(1); // separate cluster keeps full width
    expect(by.x!.lane).toBe(0);
  });

  it('handles an empty input', () => {
    expect(assignLanes([], () => ({ startMs: 0, endMs: 0 }))).toEqual([]);
  });
});
