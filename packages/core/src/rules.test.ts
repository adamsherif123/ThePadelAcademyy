import type { CreditBatch, IsoInstant, Player, SessionSlot, TrainingType } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { TRAINING_TYPES } from './constants';
import { buildSignupGrant } from './credits';
import {
  bookableTypesFor,
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
    manuallyConfirmedAt: null,
    setByBookingAt: null,
    ...over,
  };
}

/** An OPEN block: untyped, and therefore (group_shape) carries no gender/level yet either. */
function openSlot(over: Partial<SessionSlot> = {}): SessionSlot {
  return slot({ trainingType: null, gender: null, level: null, ...over });
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

describe('session confirmation — DERIVED fill OR STICKY manual (S11.1)', () => {
  it('DERIVED: full is confirmed, not-full is pending (a duo at 1/2 is NOT confirmed)', () => {
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 4, manuallyConfirmedAt: null }))).toBe(true); // full
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 3, manuallyConfirmedAt: null }))).toBe(false); // 3/4 pending
    expect(isSessionConfirmed(slot({ capacity: 2, bookedCount: 1, manuallyConfirmedAt: null }))).toBe(false); // the S11 duo-1/2 lie, fixed
  });

  it('DERIVED un-fills back to pending (fixes S11 sticky-fill); MANUAL survives an un-fill', () => {
    // 4/4 → a cancel drops it to 3/4, NO manual confirm → pending again
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 3, manuallyConfirmedAt: null }))).toBe(false);
    // 4/4 → 3/4 but Rania confirmed it → STAYS confirmed (her recorded decision)
    expect(isSessionConfirmed(slot({ capacity: 4, bookedCount: 3, manuallyConfirmedAt: NOW }))).toBe(true);
  });

  it('capacity-1 confirms on the first booking, always (fixes "PENDING · 0 TO FILL")', () => {
    expect(isSessionConfirmed(slot({ capacity: 1, bookedCount: 1, manuallyConfirmedAt: null }))).toBe(true); // full-by-1
    expect(isSessionConfirmed(slot({ capacity: 1, bookedCount: 0, manuallyConfirmedAt: null }))).toBe(false); // empty
  });

  it('spotsUntilConfirmed is seats-to-fill while pending, 0 once confirmed (fill OR manual)', () => {
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 3, manuallyConfirmedAt: null }))).toBe(1);
    expect(spotsUntilConfirmed(slot({ capacity: 2, bookedCount: 0, manuallyConfirmedAt: null }))).toBe(2);
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 4, manuallyConfirmedAt: null }))).toBe(0); // full → 0
    expect(spotsUntilConfirmed(slot({ capacity: 4, bookedCount: 3, manuallyConfirmedAt: NOW }))).toBe(0);   // manual → 0
  });
});

describe('isGroupSlot', () => {
  it('narrows only group slots', () => {
    expect(isGroupSlot(slot({ trainingType: 'group' }))).toBe(true);
    expect(isGroupSlot(slot({ trainingType: 'individual', gender: null, level: null }))).toBe(false);
  });

  it('an OPEN (untyped) slot is never a group slot — null !== "group" needs no special-casing', () => {
    expect(isGroupSlot(openSlot())).toBe(false);
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
  it('is true only more than 5h before start', () => {
    // start 18:00Z, now 12:00Z => 6h before => free
    expect(isCancellableWithoutForfeit(slot(), NOW)).toBe(true);
    // now 15:30Z => 2.5h before => forfeit
    expect(isCancellableWithoutForfeit(slot(), '2026-07-14T15:30:00.000Z' as IsoInstant)).toBe(false);
    // exactly 5h before => not strictly greater => forfeit
    expect(isCancellableWithoutForfeit(slot(), '2026-07-14T13:00:00.000Z' as IsoInstant)).toBe(false);
    expect(isCancellableWithoutForfeit(slot({ status: 'cancelled' }), NOW)).toBe(false);
  });
});

describe('cancellationDeadline', () => {
  it('is CANCELLATION_WINDOW_HOURS (5h) before the slot starts', () => {
    // startsAt 18:00Z -> deadline 13:00Z
    expect(cancellationDeadline(slot())).toBe('2026-07-14T13:00:00.000Z');
    expect(cancellationDeadline(slot({ startsAt: '2026-07-22T16:30:00.000Z' as IsoInstant }))).toBe(
      '2026-07-22T11:30:00.000Z',
    );
  });
});

describe('canBookSlot — TYPED slot (regression: unchanged from before the booking rework, minus level)', () => {
  it('succeeds and picks the earliest-expiring usable batch; names the resolved type', () => {
    const later = batch({ id: 'cb_later' as CreditBatch['id'], expiresAt: '2026-09-01T00:00:00.000Z' as IsoInstant });
    const sooner = batch({ id: 'cb_sooner' as CreditBatch['id'], expiresAt: '2026-07-20T00:00:00.000Z' as IsoInstant });
    const res = canBookSlot(slot(), player, [later, sooner], NOW, 'group');
    expect(res).toEqual({ ok: true, creditBatchId: 'cb_sooner', trainingType: 'group' });
  });

  it('reports each blocking reason', () => {
    expect(canBookSlot(slot({ status: 'cancelled' }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_cancelled' });
    expect(canBookSlot(slot({ startsAt: '2026-07-14T11:00:00.000Z' as IsoInstant }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_in_past' });
    expect(canBookSlot(slot({ capacity: 4, bookedCount: 4 }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_full' });
    expect(canBookSlot(slot(), player, [], NOW, 'group')).toEqual({ ok: false, reason: 'no_usable_credit' });
    expect(canBookSlot(slot({ trainingType: 'duo', gender: null, level: null }), player, [batch()], NOW, 'duo')).toEqual({ ok: false, reason: 'no_usable_credit' });
  });

  it('rule 4: a LEVEL mismatch never blocks — the positive proof (display-only)', () => {
    const mismatched = slot({ level: 'intermediate' }); // player is 'beginner'
    expect(canBookSlot(mismatched, player, [batch()], NOW, 'group')).toEqual({
      ok: true,
      creditBatchId: 'cb_1',
      trainingType: 'group',
    });
  });

  it('rule 4: a GENDER mismatch never blocks either — the positive proof (display-only, extended by the gender-display-only migration)', () => {
    const mismatched = slot({ gender: 'ladies' }); // player is 'men'
    expect(canBookSlot(mismatched, player, [batch()], NOW, 'group')).toEqual({
      ok: true,
      creditBatchId: 'cb_1',
      trainingType: 'group',
    });
  });

  it('type_mismatch: a chosenType that disagrees with an ALREADY-typed slot is rejected, even with a usable credit for the (wrong) chosen type', () => {
    const duoCredit = batch({ trainingType: 'duo' });
    expect(canBookSlot(slot({ trainingType: 'group' }), player, [duoCredit], NOW, 'duo')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('ignores another player’s credits', () => {
    const foreign = batch({ id: 'cb_foreign' as CreditBatch['id'], playerId: 'pl_other' as Player['id'] });
    expect(canBookSlot(slot(), player, [foreign], NOW, 'group')).toEqual({ ok: false, reason: 'no_usable_credit' });
  });

  it('a granted trial credit books a trial slot but no other format', () => {
    const grant = buildSignupGrant(player.id, NOW);
    const trialSlot = slot({ trainingType: 'trial', gender: null, level: null });
    expect(canBookSlot(trialSlot, player, [grant], NOW, 'trial')).toEqual({
      ok: true,
      creditBatchId: grant.id,
      trainingType: 'trial',
    });

    // The typed-credit rule blocks the trial credit on every paid format — no
    // purchase-vs-grant logic was needed; source is irrelevant to usability.
    for (const trainingType of ['group', 'duo', 'individual'] as const) {
      const paidSlot = slot({ trainingType, gender: null, level: null });
      expect(canBookSlot(paidSlot, player, [grant], NOW, trainingType)).toEqual({ ok: false, reason: 'no_usable_credit' });
    }
  });
});

describe('canBookSlot — OPEN (untyped) slot: the first booking picks the type (rules 1 + 2)', () => {
  it('succeeds for whichever type the player chooses AND holds a usable credit for, naming that type as resolved', () => {
    const duoCredit = batch({ trainingType: 'duo' });
    const res = canBookSlot(openSlot(), player, [duoCredit], NOW, 'duo');
    expect(res).toEqual({ ok: true, creditBatchId: 'cb_1', trainingType: 'duo' });
  });

  it('rejects the choice if the player holds no usable credit of THAT chosen type — even holding a DIFFERENT type does not help (the picker rule, server-enforced)', () => {
    const groupCredit = batch({ trainingType: 'group' });
    expect(canBookSlot(openSlot(), player, [groupCredit], NOW, 'duo')).toEqual({ ok: false, reason: 'no_usable_credit' });
  });

  it('gender never blocks the first booking on an open slot (trivially — it starts null) or any later one (display-only)', () => {
    const ladiesPlayer: Player = { ...player, gender: 'ladies' };
    const res = canBookSlot(openSlot(), ladiesPlayer, [batch({ playerId: ladiesPlayer.id, trainingType: 'group' })], NOW, 'group');
    expect(res).toEqual({ ok: true, creditBatchId: 'cb_1', trainingType: 'group' });
  });

  it('every other block reason still applies to an open slot regardless of type (cancelled, past, full)', () => {
    expect(canBookSlot(openSlot({ status: 'cancelled' }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_cancelled' });
    expect(canBookSlot(openSlot({ startsAt: '2026-07-14T11:00:00.000Z' as IsoInstant }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_in_past' });
    expect(canBookSlot(openSlot({ capacity: 4, bookedCount: 4 }), player, [batch()], NOW, 'group')).toEqual({ ok: false, reason: 'slot_full' });
  });

  it('an open slot can never itself produce type_mismatch — that reason requires an already-typed slot', () => {
    for (const trainingType of TRAINING_TYPES) {
      const res = canBookSlot(openSlot(), player, [], NOW, trainingType);
      expect(res).not.toEqual({ ok: false, reason: 'type_mismatch' });
    }
  });
});

describe('bookableTypesFor', () => {
  it('a TYPED slot yields at most one entry: its own type, if affordable', () => {
    expect(bookableTypesFor(slot({ trainingType: 'group' }), player, [batch({ trainingType: 'group', quantityRemaining: 3 })], NOW)).toEqual([
      { trainingType: 'group', creditBatchId: 'cb_1', creditsAvailable: 3 },
    ]);
  });

  it('a TYPED slot with no usable credit for its type yields nothing, even if the player holds OTHER types', () => {
    const duoCredit = batch({ trainingType: 'duo' });
    expect(bookableTypesFor(slot({ trainingType: 'group' }), player, [duoCredit], NOW)).toEqual([]);
  });

  it('an OPEN slot yields every type the player can afford, each with its own summed balance', () => {
    const groupBatches = [
      batch({ id: 'cb_g1' as CreditBatch['id'], trainingType: 'group', quantityRemaining: 2 }),
      batch({ id: 'cb_g2' as CreditBatch['id'], trainingType: 'group', quantityRemaining: 1, expiresAt: '2026-07-25T00:00:00.000Z' as IsoInstant }),
    ];
    const duoBatch = batch({ id: 'cb_d' as CreditBatch['id'], trainingType: 'duo', quantityRemaining: 4 });
    const result = bookableTypesFor(openSlot(), player, [...groupBatches, duoBatch], NOW);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { trainingType: 'group', creditBatchId: 'cb_g2', creditsAvailable: 3 }, // earliest-expiring of the two group batches
        { trainingType: 'duo', creditBatchId: 'cb_d', creditsAvailable: 4 },
      ]),
    );
  });

  it('an OPEN slot with zero usable credits of any type yields an empty array', () => {
    expect(bookableTypesFor(openSlot(), player, [], NOW)).toEqual([]);
  });

  it('an OPEN slot excludes an expired batch from both eligibility and the credit sum', () => {
    const expired = batch({ trainingType: 'individual', expiresAt: '2026-07-01T00:00:00.000Z' as IsoInstant });
    expect(bookableTypesFor(openSlot(), player, [expired], NOW)).toEqual([]);
  });

  it('an OPEN slot ignores another player’s credits entirely', () => {
    const foreign = batch({ playerId: 'pl_other' as Player['id'], trainingType: 'trial' });
    expect(bookableTypesFor(openSlot(), player, [foreign], NOW)).toEqual([]);
  });

  it('an OPEN, FULL/cancelled/past slot yields nothing regardless of credits held', () => {
    const allTypes = TRAINING_TYPES.map((t, i) =>
      batch({ id: `cb_${i}` as CreditBatch['id'], trainingType: t, quantityRemaining: 5 }),
    );
    expect(bookableTypesFor(openSlot({ status: 'cancelled' }), player, allTypes, NOW)).toEqual([]);
    expect(bookableTypesFor(openSlot({ startsAt: '2026-07-14T11:00:00.000Z' as IsoInstant }), player, allTypes, NOW)).toEqual([]);
    expect(bookableTypesFor(openSlot({ capacity: 2, bookedCount: 2 }), player, allTypes, NOW)).toEqual([]);
  });

  it('an OPEN slot holding credits for ALL four types offers all four', () => {
    const allTypes = TRAINING_TYPES.map((t, i) =>
      batch({ id: `cb_${i}` as CreditBatch['id'], trainingType: t, quantityRemaining: 1 }),
    );
    const result = bookableTypesFor(openSlot(), player, allTypes, NOW);
    expect(result.map((r) => r.trainingType).sort()).toEqual([...TRAINING_TYPES].sort());
  });
});

/** Every TrainingType member is exercised somewhere above — a compile-time nudge, not a runtime one. */
const _exhaustive: readonly TrainingType[] = TRAINING_TYPES;
void _exhaustive;
