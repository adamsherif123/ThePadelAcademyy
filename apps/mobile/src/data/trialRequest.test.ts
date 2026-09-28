import type { CreditRequest, Location, LocationId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { pendingTrialBranchName, trialRefusalKind } from './trialRequest';

const loc = (id: string, name: string): Location =>
  ({ id: id as LocationId, name, address: 'a', mapsUrl: 'm', hoursText: 'h', sortOrder: 0, isActive: true, isDefault: false }) as Location;
const LOCS = [loc('loc_oro', 'Oro Plaza Hotel'), loc('loc_qa', 'S7 QA Branch')];

const req = (over: Partial<CreditRequest> = {}): CreditRequest =>
  ({ id: 'cr_1', playerId: 'pl_1', packageId: 'pk_1', locationId: 'loc_qa' as LocationId,
     paymentMethod: 'instapay', proofPath: null, status: 'pending', createdAt: '2026-09-28T00:00:00.000Z',
     resolvedAt: null, rejectReason: null, purchaseId: null, isTrial: true, ...over }) as CreditRequest;

describe('pendingTrialBranchName — which branch the waiting trial is at', () => {
  it('names the branch of a pending trial request', () => {
    expect(pendingTrialBranchName([req()], LOCS)).toBe('S7 QA Branch');
  });

  // An APPROVED trial is one the player HAS. They are not waiting, and
  // "you've already used your trial" is the honest thing to say.
  it('ignores an approved trial — that player really has used it', () => {
    expect(pendingTrialBranchName([req({ status: 'approved' })], LOCS)).toBeNull();
  });

  // The one-trial index excludes 'rejected' so a declined attempt can be retried;
  // treating one as live would tell a player they are blocked when they are not.
  it('ignores a rejected trial, which can be retried', () => {
    expect(pendingTrialBranchName([req({ status: 'rejected' })], LOCS)).toBeNull();
  });

  it('ignores a pending NON-trial request', () => {
    expect(pendingTrialBranchName([req({ isTrial: false })], LOCS)).toBeNull();
  });

  it('is null with no requests at all', () => {
    expect(pendingTrialBranchName([], LOCS)).toBeNull();
  });

  // The copy falls back to "another location" rather than printing an id.
  it('is null when the branch row cannot be resolved', () => {
    expect(pendingTrialBranchName([req({ locationId: 'loc_gone' as LocationId })], LOCS)).toBeNull();
  });
});

describe('trialRefusalKind — one server reason, two different players', () => {
  // The whole point: the server says `trial_already_used` for both, and only the
  // client knows which one is standing there.
  it('a player WITH a pending trial is waiting, not blocked', () => {
    expect(trialRefusalKind('trial_already_used', true)).toBe('trial_pending');
  });

  it('a player WITHOUT one really has used their trial', () => {
    expect(trialRefusalKind('trial_already_used', false)).toBe('plain');
  });

  it('every other refusal is plain, pending trial or not', () => {
    for (const reason of ['package_missing', 'package_inactive', 'already_pending', 'not_authenticated'] as const) {
      expect(trialRefusalKind(reason, true)).toBe('plain');
      expect(trialRefusalKind(reason, false)).toBe('plain');
    }
  });
});
