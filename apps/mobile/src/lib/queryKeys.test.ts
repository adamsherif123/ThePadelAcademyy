import { describe, expect, it } from 'vitest';

import { BOOKING_TOUCHED_KEYS, SLOT_BEARING_KEYS, queryKeys } from './queryKeys';

const has = (set: readonly (readonly string[])[], key: readonly string[]) =>
  set.some((k) => k.length === key.length && k.every((part, i) => part === key[i]));

/**
 * The bug this exists for: `slotsByIds` was added as a second slot cache in S7b
 * and never added to BOOKING_TOUCHED_KEYS. Booking a group session then left the
 * confirmation screen reading the PRE-booking slot, so the second player to join
 * was told "You started it" and given the wrong count of players still needed.
 *
 * Nothing failed. It is a missing line in a list, and a list cannot notice a gap
 * in itself — so these assertions derive the list instead of repeating it.
 */
describe('a booking invalidates every cache that holds a slot', () => {
  it('every slot-bearing key is in the booking invalidation set', () => {
    for (const key of SLOT_BEARING_KEYS) {
      expect(has(BOOKING_TOUCHED_KEYS, key), `${key.join('/')} must be invalidated by a booking`).toBe(true);
    }
  });

  // The one that would actually have caught it: a NEW slot cache, added later and
  // forgotten, is found by name rather than by someone remembering this file.
  it('no key that caches slots is missing from SLOT_BEARING_KEYS', () => {
    const slotish = Object.entries(queryKeys)
      .filter(([name]) => name.toLowerCase().includes('slot'))
      // The coach's own schedule, on the coach's own device. A player booking here
      // cannot invalidate a cache over there, so it is not in the player's set.
      .filter(([name]) => name !== 'coachSlots');
    expect(slotish.length).toBeGreaterThan(1);
    for (const [name, key] of slotish) {
      expect(has(SLOT_BEARING_KEYS, key), `queryKeys.${name} looks like a slot cache but is not declared as one`).toBe(true);
    }
  });

  it('still invalidates the wallet and the bookings list', () => {
    expect(has(BOOKING_TOUCHED_KEYS, queryKeys.creditBatches)).toBe(true);
    expect(has(BOOKING_TOUCHED_KEYS, queryKeys.bookings)).toBe(true);
  });

  // Invalidating a prefix refreshes every branch's entry beneath it, which is the
  // property the per-branch keys (['slots', locationId]) rely on.
  it('the slot keys are PREFIXES, not fully-qualified keys', () => {
    for (const key of SLOT_BEARING_KEYS) expect(key.length).toBe(1);
  });
});
