import { describe, expect, it } from 'vitest';

import { ID_PREFIXES, newId } from './ids';

describe('newId', () => {
  it('prefixes the id per entity', () => {
    expect(newId(ID_PREFIXES.player).startsWith('pl_')).toBe(true);
    expect(newId(ID_PREFIXES.coach).startsWith('co_')).toBe(true);
    expect(newId(ID_PREFIXES.booking).startsWith('bk_')).toBe(true);
  });

  it('appends a v4 uuid', () => {
    const id = newId(ID_PREFIXES.slot);
    const uuid = id.slice(ID_PREFIXES.slot.length);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is collision-free across many draws', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId(ID_PREFIXES.purchase)));
    expect(ids.size).toBe(5000);
  });
});
