import { isBatchUsable } from '@tpa/core';
import { MOCK_NOW } from '@tpa/mocks';
import type { Gender, Level, PlayerId } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { creditBreakdown, mismatchedActiveBookings, updatePlayerProfile } from './players';
import { __resetStoreForTests, getBatches, getBookings, getPlayers, getSlots } from './store';
import { matchesPlayerQuery } from '../ui/playerQuery';

const now = MOCK_NOW;
beforeEach(() => __resetStoreForTests());

describe('creditBreakdown', () => {
  it('sums usable G/D/I credits, cross-checked against isBatchUsable', () => {
    const playerId = getBatches()[0]!.playerId;
    const bd = creditBreakdown(playerId, now);
    const manual = (type: 'group' | 'duo' | 'individual') =>
      getBatches()
        .filter((b) => b.playerId === playerId && isBatchUsable(b, type, now))
        .reduce((s, b) => s + b.quantityRemaining, 0);
    expect(bd.group).toBe(manual('group'));
    expect(bd.duo).toBe(manual('duo'));
    expect(bd.individual).toBe(manual('individual'));
    expect(bd.total).toBe(bd.group + bd.duo + bd.individual);
  });
});

describe('matchesPlayerQuery (the single shared predicate)', () => {
  it('matches on name substring and on phone with or without spaces', () => {
    const p = getPlayers()[0]!;
    expect(matchesPlayerQuery(p, p.name.slice(0, 3).toLowerCase())).toBe(true);
    expect(matchesPlayerQuery(p, p.phone)).toBe(true);
    expect(matchesPlayerQuery(p, p.phone.replace(/\s+/g, ''))).toBe(true);
    expect(matchesPlayerQuery(p, 'zzzzzz-nomatch')).toBe(false);
    expect(matchesPlayerQuery(p, '')).toBe(true); // empty matches everything
  });
});

describe('updatePlayerProfile', () => {
  it('edits gender/level in place and leaves existing bookings untouched', () => {
    // A player holding an active GROUP booking.
    const groupSlotIds = new Set(getSlots().filter((s) => s.trainingType === 'group').map((s) => s.id));
    const booking = getBookings().find((b) => b.status === 'booked' && groupSlotIds.has(b.slotId));
    if (!booking) throw new Error('no active group booking in fixtures');
    const playerId = booking.playerId;
    const bookingsBefore = JSON.stringify(getBookings().filter((b) => b.playerId === playerId));

    const flip = (g: Gender): Gender => (g === 'men' ? 'ladies' : 'men');
    const current = getPlayers().find((p) => p.id === playerId)!;
    const res = updatePlayerProfile(playerId, {
      name: current.name,
      phone: current.phone,
      gender: flip(current.gender),
      level: 'intermediate' as Level,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.player.gender).toBe(flip(current.gender));
    expect(res.player.level).toBe('intermediate');
    // Bookings are NOT rewritten by a profile change.
    expect(JSON.stringify(getBookings().filter((b) => b.playerId === playerId))).toBe(bookingsBefore);
  });

  it('flags mismatched active group bookings for the edit warning', () => {
    const genderedGroup = new Map(
      getSlots().filter((s) => s.trainingType === 'group' && s.gender !== null).map((s) => [s.id, s]),
    );
    const booking = getBookings().find((b) => b.status === 'booked' && genderedGroup.has(b.slotId));
    if (!booking) throw new Error('no active booking on a gendered group slot');
    const slot = genderedGroup.get(booking.slotId)!;
    const opposite: Gender = slot.gender === 'men' ? 'ladies' : 'men';
    expect(mismatchedActiveBookings(booking.playerId, opposite, slot.level!)).toBeGreaterThan(0);
  });

  it('rejects empty name/phone and unknown players', () => {
    const playerId = getPlayers()[0]!.id;
    const p = getPlayers()[0]!;
    expect(updatePlayerProfile(playerId, { name: ' ', phone: p.phone, gender: p.gender, level: p.level }).ok ? null : 'n').toBe('n');
    const noPhone = updatePlayerProfile(playerId, { name: p.name, phone: '', gender: p.gender, level: p.level });
    expect(noPhone.ok ? null : noPhone.reason).toBe('phone_required');
    const missing = updatePlayerProfile('pl_nope' as PlayerId, { name: 'X', phone: '1', gender: 'men', level: 'beginner' });
    expect(missing.ok ? null : missing.reason).toBe('player_missing');
  });
});
