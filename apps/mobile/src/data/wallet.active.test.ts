import { isBatchUsable } from '@tpa/core';
import type { CreditBatch, IsoInstant, TrainingType } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { activeBatches, balanceByType, totalReadyToBook } from './wallet';

const NOW = '2026-08-23T12:00:00.000Z' as IsoInstant;
const UNEXPIRED = '2026-12-01T00:00:00.000Z' as IsoInstant;
const EXPIRED = '2026-08-01T00:00:00.000Z' as IsoInstant;

const b = (
  id: string,
  remaining: number,
  expiresAt: IsoInstant,
  trainingType: TrainingType = 'group',
): CreditBatch =>
  ({
    id, playerId: 'pl_x', source: 'purchase', purchaseId: null, trainingType,
    quantityTotal: 10, quantityRemaining: remaining, expiresAt, createdAt: NOW, note: null,
  }) as CreditBatch;

/**
 * The Wallet's batch-card list. "Active" must stay EXACTLY @tpa/core's
 * isBatchUsable — the rule the headline and pills already count by — so the
 * cards and the balance above them can never tell the player two stories.
 */
describe('activeBatches — what the Wallet lists', () => {
  it('lists an unexpired batch with credits left', () => {
    expect(activeBatches([b('cb_live', 4, UNEXPIRED)], NOW).map((x) => x.id)).toEqual(['cb_live']);
  });

  it('hides a FULLY SPENT batch, even though it has not expired', () => {
    expect(activeBatches([b('cb_spent', 0, UNEXPIRED)], NOW)).toEqual([]);
  });

  it('hides an EXPIRED batch, even with credits left on it', () => {
    expect(activeBatches([b('cb_lost', 3, EXPIRED)], NOW)).toEqual([]);
  });

  it('keeps soonest-expiry-first ordering', () => {
    const soon = '2026-09-01T00:00:00.000Z' as IsoInstant;
    const later = '2026-11-01T00:00:00.000Z' as IsoInstant;
    const ids = activeBatches([b('cb_later', 1, later), b('cb_soon', 1, soon)], NOW).map((x) => x.id);
    expect(ids).toEqual(['cb_soon', 'cb_later']);
  });

  it('is isBatchUsable itself — not a second definition of "active"', () => {
    const all = [
      b('cb_live', 4, UNEXPIRED),
      b('cb_spent', 0, UNEXPIRED),
      b('cb_lost', 3, EXPIRED),
      b('cb_trial', 1, UNEXPIRED, 'trial'),
    ];
    expect(activeBatches(all, NOW).map((x) => x.id)).toEqual(
      all.filter((x) => isBatchUsable(x, x.trainingType, NOW)).map((x) => x.id),
    );
  });

  it('every listed batch contributes to the headline the pills show', () => {
    const all = [b('cb_live', 4, UNEXPIRED), b('cb_spent', 0, UNEXPIRED), b('cb_lost', 3, EXPIRED)];
    const listed = activeBatches(all, NOW);
    const listedCredits = listed.reduce((s, x) => s + x.quantityRemaining, 0);
    expect(listedCredits).toBe(totalReadyToBook(all, NOW));
    expect(balanceByType(all, NOW).group).toBe(4);
  });

  it('a player whose batches are ALL spent or expired lists nothing (→ empty state)', () => {
    expect(activeBatches([b('cb_spent', 0, UNEXPIRED), b('cb_lost', 3, EXPIRED)], NOW)).toEqual([]);
  });
});
