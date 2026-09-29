import type { Booking, CreditBatch, CreditBatchId, IsoInstant, LocationId, Player, SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { sessionsForDay } from './booking';
import { cairoCalendarDate } from '@tpa/core';

/**
 * The bug: a player with perfectly good credits at one branch, looking at a
 * session at another, was told "Your credits have expired" — about credits that
 * had not expired, and in one case about a branch whose credits they had never
 * held. Two separate mistakes fed it:
 *
 *   1. The expired-credit check scanned EVERY branch, so a lapsed batch
 *      somewhere else explained a slot here.
 *   2. An OPEN block never produced `wrong_location` at all — bookableTypesFor
 *      reports that no type is bookable, not why — so it fell through to the
 *      credit-shortfall copy.
 */
const NOW = '2026-09-30T12:00:00.000Z' as IsoInstant;
const ORO = 'loc_oro' as LocationId;
const QA = 'loc_qa' as LocationId;

const player = {
  id: 'pl_1', name: 'A', phone: '+20', gender: 'men', level: 'beginner',
  createdAt: NOW, isOwner: false, coachId: null, deletedAt: null,
} as unknown as Player;

const slot = (over: Partial<SessionSlot> = {}): SessionSlot =>
  ({
    id: 'sl_1', locationId: ORO, coachId: 'co_1', startsAt: '2026-10-02T15:00:00.000Z' as IsoInstant,
    endsAt: '2026-10-02T16:00:00.000Z' as IsoInstant, trainingType: 'group', capacity: 4, bookedCount: 0,
    gender: 'men', level: 'beginner', status: 'published', templateId: null,
    manuallyConfirmedAt: null, preBookingCapacity: null, setByBookingAt: null, remindedAt: null,
    ...over,
  }) as unknown as SessionSlot;

const batch = (over: Partial<CreditBatch> = {}): CreditBatch =>
  ({
    id: 'cb_1', playerId: 'pl_1', source: 'purchase', purchaseId: 'pu_1', transferredFrom: null,
    locationId: QA, trainingType: 'group', quantityTotal: 4, quantityRemaining: 4,
    expiresAt: '2026-12-01T00:00:00.000Z' as IsoInstant, createdAt: NOW, note: null,
    ...over,
  }) as CreditBatch;

const verdict = (s: SessionSlot, batches: CreditBatch[], bookings: Booking[] = []) =>
  sessionsForDay([s], player, batches, bookings, NOW, cairoCalendarDate(s.startsAt))[0]!.availability;

describe('a typed slot at a branch the player has no credits for', () => {
  it('is wrong_location, and names where the credits actually are', () => {
    expect(verdict(slot(), [batch()])).toEqual({ kind: 'wrong_location', locationId: QA });
  });

  // The reported bug. The QA batch has lapsed, the player holds nothing at Oro,
  // and the screen said "your credits have expired" — of credits that were never
  // spendable at Oro in the first place.
  it('is NO_CREDIT when the only lapsed batch is at another branch', () => {
    const lapsedElsewhere = batch({ expiresAt: '2026-01-01T00:00:00.000Z' as IsoInstant });
    expect(verdict(slot(), [lapsedElsewhere])).toEqual({ kind: 'no_credit' });
  });

  it('is credits_expired only when the lapsed batch is at THIS branch', () => {
    const lapsedHere = batch({ locationId: ORO, expiresAt: '2026-01-01T00:00:00.000Z' as IsoInstant });
    expect(verdict(slot(), [lapsedHere])).toEqual({ kind: 'credits_expired' });
  });

  it('is no_credit for a player with nothing anywhere', () => {
    expect(verdict(slot(), [])).toEqual({ kind: 'no_credit' });
  });

  it('is bookable when the credits ARE here', () => {
    expect(verdict(slot(), [batch({ locationId: ORO })]).kind).toBe('bookable');
  });
});

describe('an OPEN block at a branch the player has no credits for', () => {
  const open = slot({ trainingType: null, gender: null, level: null });

  // Previously impossible: openBlockAvailability had no wrong_location branch,
  // so this player was told they had no credits — and the card became tappable
  // into the wrong prompt.
  it('is wrong_location, not no_credit', () => {
    expect(verdict(open, [batch()])).toEqual({ kind: 'wrong_location', locationId: QA });
  });

  it('is NO_CREDIT when the only lapsed batch is at another branch', () => {
    expect(verdict(open, [batch({ expiresAt: '2026-01-01T00:00:00.000Z' as IsoInstant })])).toEqual({ kind: 'no_credit' });
  });

  it('is credits_expired only when the lapsed batch is at THIS branch', () => {
    expect(verdict(open, [batch({ locationId: ORO, expiresAt: '2026-01-01T00:00:00.000Z' as IsoInstant })])).toEqual({
      kind: 'credits_expired',
    });
  });

  // A usable credit here wins over a lapsed one there: the block is bookable and
  // nothing about another branch should be mentioned.
  it('is bookable when any type works here, whatever sits elsewhere', () => {
    expect(verdict(open, [batch({ locationId: ORO }), batch({ id: 'cb_2' as CreditBatchId, expiresAt: '2026-01-01T00:00:00.000Z' as IsoInstant })]).kind).toBe('bookable');
  });
});
