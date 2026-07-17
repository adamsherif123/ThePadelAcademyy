import { isBatchUsable } from '@tpa/core';
import { MOCK_NOW, mockBookings, mockCreditBatches, mockPlayers, mockPurchases, mockSlots } from '@tpa/mocks';
import type { Gender } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  batchesForPlayerSorted,
  creditBreakdown,
  mismatchedActiveBookings,
  purchasesForPlayer,
  updatePlayerProfile,
} from './players';
import { matchesPlayerQuery } from '../ui/playerQuery';

/**
 * Player read selectors are pure over the fetched rows. S10b intentionally does NOT
 * wire admin profile edits (no RLS policy) — updatePlayerProfile now always reports
 * `not_supported`, so only that contract is asserted (its old edit tests are gone).
 */

const now = MOCK_NOW;
const ms = (i: string) => new Date(i).getTime();

describe('creditBreakdown', () => {
  it('sums usable G/D/I credits, cross-checked against isBatchUsable', () => {
    const playerId = mockCreditBatches[0]!.playerId;
    const bd = creditBreakdown(mockCreditBatches, playerId, now);
    const manual = (type: 'group' | 'duo' | 'individual') =>
      mockCreditBatches
        .filter((b) => b.playerId === playerId && isBatchUsable(b, type, now))
        .reduce((s, b) => s + b.quantityRemaining, 0);
    expect(bd.group).toBe(manual('group'));
    expect(bd.duo).toBe(manual('duo'));
    expect(bd.individual).toBe(manual('individual'));
    expect(bd.total).toBe(bd.group + bd.duo + bd.individual);
  });
});

describe('batchesForPlayerSorted', () => {
  it('returns only that player, newest first', () => {
    const playerId = mockCreditBatches[0]!.playerId;
    const sorted = batchesForPlayerSorted(mockCreditBatches, playerId);
    expect(sorted.length).toBeGreaterThan(0);
    expect(sorted.every((b) => b.playerId === playerId)).toBe(true);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(ms(sorted[i - 1]!.createdAt)).toBeGreaterThanOrEqual(ms(sorted[i]!.createdAt));
    }
  });
});

describe('purchasesForPlayer', () => {
  it('returns only that player, newest first', () => {
    const playerId = mockPurchases[0]!.playerId;
    const rows = purchasesForPlayer(mockPurchases, playerId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.playerId === playerId)).toBe(true);
    for (let i = 1; i < rows.length; i += 1) {
      expect(ms(rows[i - 1]!.createdAt)).toBeGreaterThanOrEqual(ms(rows[i]!.createdAt));
    }
  });
});

describe('matchesPlayerQuery (the single shared predicate)', () => {
  it('matches on name substring and on phone with or without spaces', () => {
    const p = mockPlayers[0]!;
    expect(matchesPlayerQuery(p, p.name.slice(0, 3).toLowerCase())).toBe(true);
    expect(matchesPlayerQuery(p, p.phone)).toBe(true);
    expect(matchesPlayerQuery(p, p.phone.replace(/\s+/g, ''))).toBe(true);
    expect(matchesPlayerQuery(p, 'zzzzzz-nomatch')).toBe(false);
    expect(matchesPlayerQuery(p, '')).toBe(true); // empty matches everything
  });
});

describe('mismatchedActiveBookings', () => {
  it('flags active group bookings whose gender/level would clash with a proposed profile', () => {
    const genderedGroup = new Map(
      mockSlots.filter((s) => s.trainingType === 'group' && s.gender !== null).map((s) => [s.id, s]),
    );
    const booking = mockBookings.find((b) => b.status === 'booked' && genderedGroup.has(b.slotId));
    if (!booking) throw new Error('no active booking on a gendered group slot');
    const slot = genderedGroup.get(booking.slotId)!;
    const opposite: Gender = slot.gender === 'men' ? 'ladies' : 'men';
    expect(
      mismatchedActiveBookings(mockBookings, mockSlots, booking.playerId, opposite, slot.level!),
    ).toBeGreaterThan(0);
  });
});

describe('updatePlayerProfile', () => {
  it('is not supported (no admin RLS policy to edit another player)', () => {
    const p = mockPlayers[0]!;
    const res = updatePlayerProfile(p.id, { name: 'X', phone: '1', gender: 'men', level: 'beginner' });
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.reason).toBe('not_supported');
  });
});
