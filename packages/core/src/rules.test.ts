import type { CreditBatch, IsoInstant, Player, SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { buildSignupGrant } from './credits';
import {
  canBookSlot,
  cancellationDeadline,
  isBatchUsable,
  isCancellableWithoutForfeit,
  isGroupSlot,
  isSessionConfirmed,
  slotRemainingCapacity,
  spotsUntilConfirmed,
} from './rules';

const NOW = '2026-07-14T12:00:00.000Z' as IsoInstant;

const player: Player = {
  id: 'pl_1' as Player['id'],
  phone: '+201000000000',
  name: 'Test Player',
  gender: 'men',
  level: 'beginner',
  createdAt: NOW,
};

function slot(over: Partial<SessionSlot> = {}): SessionSlot {
  return {
    id: 'sl_1' as SessionSlot['id'],
    coachId: 'co_1' as SessionSlot['coachId'],
    startsAt: '2026-07-14T18:00:00.000Z' as IsoInstant,
    endsAt: '2026-07-14T19:00:00.000Z' as IsoInstant,
    trainingType: 'group',
    capacity: 4,
    bookedCount: 0,
    gender: 'men',
    level: 'beginner',
    status: 'published',
    templateId: null,
    confirmedAt: null,
    ...over,
  };
}

function batch(over: Partial<CreditBatch> = {}): CreditBatch {
  return {
    id: 'cb_1' as CreditBatch['id'],
    playerId: player.id,
    source: 'purchase',
    purchaseId: 'pu_1' as CreditBatch['purchaseId'],
    trainingType: 'group',
    quantityTotal: 4,
    quantityRemaining: 2,
    expiresAt: '2026-08-01T00:00:00.000Z' as IsoInstant,
    createdAt: NOW,
    ...over,
  };
}

describe('slotRemainingCapacity', () => {
  it('is capacity minus bookedCount, never negative, zero when cancelled', () => {
    expect(slotRemainingCapacity(slot({ capacity: 4, bookedCount: 1 }))).toBe(3);
    expect(slotRemainingCapacity(slot({ capacity: 4, bookedCount: 4 }))).toBe(0);
    expect(slotRemainingCapacity(slot({ capacity: 4, bookedCount: 9 }))).toBe(0);
    expect(slotRemainingCapacity(slot({ status: 'cancelled', bookedCount: 0 }))).toBe(0);
  });
});

describe('session confirmation (isSessionConfirmed / spotsUntilConfirmed)', () => {
  it('reads confirmedAt, NOT booked_count — sticky, not derived', () => {
    // pending: not yet stamped, even at 3/4
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 3, confirmedAt: null }))).toBe(false);
    // confirmed: stamped
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 4, confirmedAt: NOW }))).toBe(true);
    // THE sticky case: filled (4/4) then a cancel dropped it to 3/4, but confirmedAt
    // survived → STILL confirmed. Pure derivation (booked_count>=capacity) would lie.
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 3, confirmedAt: NOW }))).toBe(true);
  });

  it('spotsUntilConfirmed is seats-to-fill while pending, 0 once confirmed', () => {
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 3, confirmedAt: null }))).toBe(1); // "1 more player"
    expect(spotsUntilConfirmed(slot({ capacity: 2, bookedCount: 0, confirmedAt: null }))).toBe(2);
    expect(spotsUntilConfirmed(slot({ capacity: 1, bookedCount: 0, confirmedAt: null }))).toBe(1); // individual: 1 booking confirms
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 4, confirmedAt: NOW }))).toBe(0);
    // sticky/un-fill: confirmed but 3/4 → still 0 (it's on; no more needed)
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 3, confirmedAt: NOW }))).toBe(0);
  });
});

describe('isGroupSlot', () => {
  it('narrows only group slots', () => {
    expect(isGroupSlot(slot({ trainingType: 'group' }))).toBe(true);
    expect(isGroupSlot(slot({ trainingType: 'individual', gender: null, level: null }))).toBe(false);
  });
});

describe('isBatchUsable', () => {
  it('requires matching type, remaining quantity, and not expired', () => {
    expect(isBatchUsable(batch(), 'group', NOW)).toBe(true);
    expect(isBatchUsable(batch({ trainingType: 'individual' }), 'group', NOW)).toBe(false);
    expect(isBatchUsable(batch({ quantityRemaining: 0 }), 'group', NOW)).toBe(false);
    expect(isBatchUsable(batch({ expiresAt: '2026-07-14T11:00:00.000Z' as IsoInstant }), 'group', NOW)).toBe(false);
  });
});

describe('isCancellableWithoutForfeit', () => {
  it('is true only more than 3h before start', () => {
    // start 18:00Z, now 12:00Z => 6h before => free
    expect(isCancellableWithoutForfeit(slot(), NOW)).toBe(true);
    // now 15:30Z => 2.5h before => forfeit
    expect(isCancellableWithoutForfeit(slot(), '2026-07-14T15:30:00.000Z' as IsoInstant)).toBe(false);
    // exactly 3h before => not strictly greater => forfeit
    expect(isCancellableWithoutForfeit(slot(), '2026-07-14T15:00:00.000Z' as IsoInstant)).toBe(false);
    expect(isCancellableWithoutForfeit(slot({ status: 'cancelled' }), NOW)).toBe(false);
  });
});

describe('cancellationDeadline', () => {
  it('is CANCELLATION_WINDOW_HOURS (3h) before the slot starts', () => {
    // startsAt 18:00Z -> deadline 15:00Z
    expect(cancellationDeadline(slot())).toBe('2026-07-14T15:00:00.000Z');
    expect(cancellationDeadline(slot({ startsAt: '2026-07-22T16:30:00.000Z' as IsoInstant }))).toBe(
      '2026-07-22T13:30:00.000Z',
    );
  });
});

describe('canBookSlot', () => {
  it('succeeds and picks the earliest-expiring usable batch', () => {
    const later = batch({ id: 'cb_later' as CreditBatch['id'], expiresAt: '2026-09-01T00:00:00.000Z' as IsoInstant });
    const sooner = batch({ id: 'cb_sooner' as CreditBatch['id'], expiresAt: '2026-07-20T00:00:00.000Z' as IsoInstant });
    const res = canBookSlot(slot(), player, [later, sooner], NOW);
    expect(res).toEqual({ ok: true, creditBatchId: 'cb_sooner' });
  });

  it('reports each blocking reason', () => {
    expect(canBookSlot(slot({ status: 'cancelled' }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'slot_cancelled' });
    expect(canBookSlot(slot({ startsAt: '2026-07-14T11:00:00.000Z' as IsoInstant }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'slot_in_past' });
    expect(canBookSlot(slot({ capacity: 4, bookedCount: 4 }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'slot_full' });
    expect(canBookSlot(slot({ gender: 'ladies' }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'gender_mismatch' });
    expect(canBookSlot(slot({ level: 'intermediate' }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'level_mismatch' });
    expect(canBookSlot(slot(), player, [], NOW)).toEqual({ ok: false, reason: 'no_usable_credit' });
    expect(canBookSlot(slot({ trainingType: 'duo', gender: null, level: null }), player, [batch()], NOW)).toEqual({ ok: false, reason: 'no_usable_credit' });
  });

  it('ignores another player’s credits', () => {
    const foreign = batch({ id: 'cb_foreign' as CreditBatch['id'], playerId: 'pl_other' as Player['id'] });
    expect(canBookSlot(slot(), player, [foreign], NOW)).toEqual({ ok: false, reason: 'no_usable_credit' });
  });

  it('a granted trial credit books a trial slot but no other format', () => {
    const grant = buildSignupGrant(player.id, NOW);
    const trialSlot = slot({ trainingType: 'trial', gender: null, level: null });
    expect(canBookSlot(trialSlot, player, [grant], NOW)).toEqual({ ok: true, creditBatchId: grant.id });

    // The typed-credit rule blocks the trial credit on every paid format — no
    // purchase-vs-grant logic was needed; source is irrelevant to usability.
    for (const trainingType of ['group', 'duo', 'individual'] as const) {
      const paidSlot = slot({ trainingType, gender: null, level: null });
      expect(canBookSlot(paidSlot, player, [grant], NOW)).toEqual({ ok: false, reason: 'no_usable_credit' });
    }
  });
});
