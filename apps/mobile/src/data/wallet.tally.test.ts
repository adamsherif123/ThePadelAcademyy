import { describe, expect, it } from 'vitest';
import { balanceByType, totalReadyToBook, visibleBalanceTypes } from './wallet';
import type { CreditBatch, IsoInstant, TrainingType } from '@tpa/types';

const NOW = '2026-08-23T12:00:00.000Z' as IsoInstant;
const b = (t: TrainingType, remaining: number, total = 10, expired = false): CreditBatch =>
  ({ id: `cb_${t}_${remaining}_${expired}`, playerId: 'pl_x', source: 'purchase', purchaseId: null,
     trainingType: t, quantityTotal: total, quantityRemaining: remaining,
     expiresAt: (expired ? '2026-08-01T00:00:00.000Z' : '2026-12-01T00:00:00.000Z') as IsoInstant,
     createdAt: NOW, note: null }) as CreditBatch;

// The REAL rule the component renders — imported, not mirrored, so this test fails
// if BalancePills' visible set ever changes.
const visible = visibleBalanceTypes;
const sumVisible = (balance: Record<TrainingType, number>) =>
  visible(balance).reduce((s, t) => s + balance[t], 0);

describe('BalancePills tally vs headline', () => {
  it('trial HELD: 4 pills, and they sum to the headline', () => {
    const batches = [b('trial', 1, 1), b('group', 8), b('individual', 3)];
    const bal = balanceByType(batches, NOW);
    expect(visible(bal)).toHaveLength(4);
    expect(sumVisible(bal)).toBe(totalReadyToBook(batches, NOW));
    expect(totalReadyToBook(batches, NOW)).toBe(12);
  });
  it('trial SPENT (remaining 0, unexpired): 3 pills, still sums to the headline', () => {
    const batches = [b('trial', 0, 1), b('group', 8), b('individual', 3)];
    const bal = balanceByType(batches, NOW);
    expect(visible(bal)).toHaveLength(3);
    expect(sumVisible(bal)).toBe(totalReadyToBook(batches, NOW));
    expect(totalReadyToBook(batches, NOW)).toBe(11);
  });
  it('trial EXPIRED with credit left: 3 pills, still sums', () => {
    const batches = [b('trial', 1, 1, true), b('group', 8)];
    const bal = balanceByType(batches, NOW);
    expect(visible(bal)).toHaveLength(3);
    expect(sumVisible(bal)).toBe(totalReadyToBook(batches, NOW));
  });
  it('trial ONLY: pill shows and equals the headline (no "0 ready" lie)', () => {
    const batches = [b('trial', 1, 1)];
    const bal = balanceByType(batches, NOW);
    expect(visible(bal)).toContain('trial');
    expect(sumVisible(bal)).toBe(1);
    expect(totalReadyToBook(batches, NOW)).toBe(1);
  });
  it('no credits at all: 3 dimmed pills, headline 0', () => {
    const bal = balanceByType([], NOW);
    expect(visible(bal)).toHaveLength(3);
    expect(sumVisible(bal)).toBe(0);
    expect(totalReadyToBook([], NOW)).toBe(0);
  });
});
