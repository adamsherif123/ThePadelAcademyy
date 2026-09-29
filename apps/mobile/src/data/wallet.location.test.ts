import type { CreditBatch, IsoInstant, LocationId, TrainingType } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { balanceByType, batchesAtLocation, locationsWithCredits, totalReadyToBook } from './wallet';

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

  // Home's empty state subtracts these two to answer "you have credits, just not
  // here". Getting it wrong tells a player with a full wallet that they have none.
  it('the credits-elsewhere figure is the difference, not a guess', () => {
    const here = totalReadyToBook(batchesAtLocation(BATCHES, ORO), NOW);
    const everywhere = totalReadyToBook(BATCHES, NOW);
    expect(everywhere - here).toBe(7);
    expect(totalReadyToBook(BATCHES, NOW) - totalReadyToBook(batchesAtLocation(BATCHES, QA), NOW)).toBe(1);
  });

  it('is zero when the only credits are the ones here — no false "you have some elsewhere"', () => {
    const onlyOro = [b('cb_1', 'group', 1, ORO)];
    expect(totalReadyToBook(onlyOro, NOW) - totalReadyToBook(batchesAtLocation(onlyOro, ORO), NOW)).toBe(0);
  });

  it('does not mutate the input', () => {
    batchesAtLocation(BATCHES, QA);
    expect(BATCHES.map((x) => x.id)).toEqual(['cb_1', 'cb_2', 'cb_3']);
  });

  // The wallet screen's contract, stated: ONE global number at the top, ONE
  // branch's batches below, and a line accounting for the difference. If these
  // three ever stop reconciling, the screen shows two numbers that disagree with
  // no explanation — which is what it did before the list was scoped.
  it('the headline, the list and the "elsewhere" line always reconcile', () => {
    for (const branch of [ORO, QA]) {
      const headline = totalReadyToBook(BATCHES, NOW);
      const listed = totalReadyToBook(batchesAtLocation(BATCHES, branch), NOW);
      const elsewhere = headline - listed;
      expect(listed + elsewhere).toBe(headline);
      expect(elsewhere).toBeGreaterThanOrEqual(0);
    }
  });

  // The loading instant: no branch resolved yet, so the list is empty. The screen
  // must not conclude from that that every credit is at another branch.
  it('has nothing to say about "elsewhere" before a branch resolves', () => {
    expect(batchesAtLocation(BATCHES, null)).toEqual([]);
  });

  // The two screens answer two different questions, and this is the contract
  // between them. Home: "how many credits do I have" — every branch. Wallet:
  // "what can I spend at the branch I am looking at" — one. They were the other
  // way round, which put the aggregate on the screen that then listed one
  // branch's batches underneath it.
  it('Home counts every branch; the wallet counts one', () => {
    const home = totalReadyToBook(BATCHES, NOW);
    const walletAtOro = totalReadyToBook(batchesAtLocation(BATCHES, ORO), NOW);
    const walletAtQa = totalReadyToBook(batchesAtLocation(BATCHES, QA), NOW);
    expect(home).toBe(8);
    expect(walletAtOro).toBe(1);
    expect(walletAtQa).toBe(7);
    // Every credit is countable at exactly one branch, so the wallets sum to Home.
    expect(walletAtOro + walletAtQa).toBe(home);
  });

  // Home's "Book a Session" button is gated on this, not on the headline: 7
  // credits at the other branch cannot book anything here.
  it('the usable-here figure is what decides whether booking is offered', () => {
    const onlyQa = [b('cb_2', 'group', 5, QA)];
    expect(totalReadyToBook(onlyQa, NOW)).toBe(5);
    expect(totalReadyToBook(batchesAtLocation(onlyQa, ORO), NOW)).toBe(0);
  });

  // Home shows "N usable at <branch>" only for a wallet that is genuinely split.
  // `elsewhere > 0` was the wrong test: it is also true for a player whose
  // credits are ALL at the other branch, and "0 usable here" tells them nothing
  // the empty card below is not already saying better.
  describe('locationsWithCredits — is this wallet split at all', () => {
    it('counts the branches holding spendable credits', () => {
      expect(locationsWithCredits(BATCHES, NOW).sort()).toEqual([ORO, QA].sort());
    });

    it('is one branch when everything sits in one place', () => {
      expect(locationsWithCredits([b('cb_1', 'group', 4, ORO)], NOW)).toEqual([ORO]);
    });

    // The case the change is for: nothing here, everything there. One branch, so
    // no breakdown line — the empty card says where the credits are instead.
    it('is still one branch when that place is not the one being browsed', () => {
      expect(locationsWithCredits([b('cb_2', 'group', 5, QA)], NOW)).toEqual([QA]);
    });

    it('ignores a spent batch — history at a second branch is not a split wallet', () => {
      const spentAtQa = { ...b('cb_spent', 'group', 5, QA), quantityRemaining: 0 } as CreditBatch;
      expect(locationsWithCredits([b('cb_1', 'group', 4, ORO), spentAtQa], NOW)).toEqual([ORO]);
    });

    it('is empty for a player with nothing', () => {
      expect(locationsWithCredits([], NOW)).toEqual([]);
    });

    it('does not double-count two batches at the same branch', () => {
      expect(locationsWithCredits([b('cb_1', 'group', 4, ORO), b('cb_3', 'individual', 2, ORO)], NOW)).toEqual([ORO]);
    });
  });
});
