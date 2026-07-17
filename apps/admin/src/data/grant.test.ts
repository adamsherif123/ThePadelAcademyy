import { CREDIT_EXPIRY_DAYS, isBatchUsable } from '@tpa/core';
import { MOCK_NOW, mockCurrentPlayer } from '@tpa/mocks';
import type { PlayerId } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { creditLiability } from './dashboard';
import { grantCredits } from './grant';
import { __resetStoreForTests, getBatches } from './store';

const player = mockCurrentPlayer.id;
beforeEach(() => __resetStoreForTests());

describe('grantCredits (admin_grant, via @tpa/core buildAdminGrant)', () => {
  it('mints a correct batch: type, quantity, 30-day expiry, purchaseId null, note set', () => {
    const res = grantCredits(player, 'group', 3, 'Rained-out session on Jul 10', MOCK_NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const b = res.batch;
    expect(b.source).toBe('admin_grant');
    expect(b.purchaseId).toBe(null); // the source ⇔ purchaseId invariant
    expect(b.trainingType).toBe('group');
    expect(b.quantityTotal).toBe(3);
    expect(b.quantityRemaining).toBe(3);
    expect(b.note).toBe('Rained-out session on Jul 10');
    expect(new Date(b.expiresAt).getTime() - new Date(MOCK_NOW).getTime()).toBe(
      CREDIT_EXPIRY_DAYS * 86_400_000, // a comp buys no extra time
    );
    expect(getBatches().some((x) => x.id === b.id)).toBe(true);
    expect(isBatchUsable(b, 'group', MOCK_NOW)).toBe(true); // a real, spendable credit
  });

  it('requires a reason, a positive quantity, and a real player', () => {
    expect(grantCredits(player, 'group', 2, '   ', MOCK_NOW).ok ? null : 'r').toBe('r');
    const noReason = grantCredits(player, 'group', 2, '', MOCK_NOW);
    expect(noReason.ok ? null : noReason.reason).toBe('reason_required');
    const zero = grantCredits(player, 'duo', 0, 'x', MOCK_NOW);
    expect(zero.ok ? null : zero.reason).toBe('quantity_below_one');
    const noPlayer = grantCredits('pl_nope' as PlayerId, 'group', 1, 'x', MOCK_NOW);
    expect(noPlayer.ok ? null : noPlayer.reason).toBe('player_missing');
  });

  it('contributes ZERO credit liability (no money changed hands) — verified after a real grant', () => {
    const before = creditLiability(MOCK_NOW);
    const res = grantCredits(player, 'individual', 4, 'Goodwill after a complaint', MOCK_NOW);
    expect(res.ok).toBe(true);
    expect(getBatches().some((b) => b.source === 'admin_grant' && b.quantityRemaining === 4)).toBe(true);
    expect(creditLiability(MOCK_NOW)).toBe(before); // liability did not move
  });
});
