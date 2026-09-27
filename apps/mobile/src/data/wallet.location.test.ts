import type { CreditBatch, IsoInstant, LocationId, TrainingType } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { balanceByType, batchesAtLocation, totalReadyToBook } from './wallet';

const NOW = '2026-08-23T12:00:00.000Z' as IsoInstant;
const ORO = 'loc_oro' as LocationId;
const QA = 'loc_qa' as LocationId;

const b = (id: string, t: TrainingType, remaining: number, locationId: LocationId): CreditBatch =>
  ({
    id,
    playerId: 'pl_x',
    source: 'purchase',
    purchaseId: null,
    locationId,
    trainingType: t,
    quantityTotal: 10,
    quantityRemaining: remaining,
    expiresAt: '2026-12-01T00:00:00.000Z' as IsoInstant,
    createdAt: NOW,
    note: null,
  }) as CreditBatch;

const BATCHES = [b('cb_1', 'group', 1, ORO), b('cb_2', 'group', 5, QA), b('cb_3', 'individual', 2, QA)];

describe('batchesAtLocation — credits are location-locked, so the wallet must be too', () => {
  it('keeps only the selected branch’s batches', () => {
    expect(batchesAtLocation(BATCHES, ORO).map((x) => x.id)).toEqual(['cb_1']);
    expect(batchesAtLocation(BATCHES, QA).map((x) => x.id)).toEqual(['cb_2', 'cb_3']);
  });

  // The headline number is what a player reads before tapping Book. Showing the
  // unscoped total would promise credits the booking RPC will refuse.
  it('the headline at Oro counts 1, not the 8 the player owns overall', () => {
    expect(totalReadyToBook(batchesAtLocation(BATCHES, ORO), NOW)).toBe(1);
    expect(totalReadyToBook(BATCHES, NOW)).toBe(8);
  });

  it('a type with credits only at the other branch reads zero here', () => {
    expect(balanceByType(batchesAtLocation(BATCHES, ORO), NOW).individual).toBe(0);
    expect(balanceByType(batchesAtLocation(BATCHES, QA), NOW).individual).toBe(2);
  });

  // Before locations load there is no selected branch. Claiming the full wallet
  // for a fraction of a second is the wrong guess: it flashes bookable.
  it('shows nothing rather than everything while no branch is selected', () => {
    expect(batchesAtLocation(BATCHES, null)).toEqual([]);
  });

  it('does not mutate the input', () => {
    batchesAtLocation(BATCHES, QA);
    expect(BATCHES.map((x) => x.id)).toEqual(['cb_1', 'cb_2', 'cb_3']);
  });
});
