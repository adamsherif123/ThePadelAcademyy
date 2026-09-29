import type { CreditRequest, CreditRequestId, IsoInstant, LocationId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { DECLINED_NOTICE_HOURS, openCreditRequest } from './wallet';

const NOW = '2026-09-29T12:00:00.000Z' as IsoInstant;
const hoursAgo = (h: number) =>
  new Date(Date.parse(NOW) - h * 3_600_000).toISOString() as IsoInstant;

const req = (over: Partial<CreditRequest> = {}): CreditRequest =>
  ({
    id: 'cr_1',
    playerId: 'pl_1',
    packageId: 'pk_1',
    locationId: 'loc_oro' as LocationId,
    paymentMethod: 'instapay',
    proofPath: null,
    status: 'pending',
    createdAt: hoursAgo(1),
    resolvedAt: null,
    rejectReason: null,
    purchaseId: null,
    isTrial: false,
    ...over,
  }) as CreditRequest;

const declined = (resolvedHoursAgo: number, over: Partial<CreditRequest> = {}) =>
  req({
    status: 'rejected',
    rejectReason: 'no',
    createdAt: hoursAgo(resolvedHoursAgo + 2),
    resolvedAt: hoursAgo(resolvedHoursAgo),
    ...over,
  });

describe('openCreditRequest — what the wallet says about a request', () => {
  it('shows a pending request', () => {
    expect(openCreditRequest([req()], NOW)?.status).toBe('pending');
  });

  // A pending request has no expiry: the player is waiting on the academy, and
  // the card is the only place that says so.
  it('shows a pending request however old it is', () => {
    expect(openCreditRequest([req({ createdAt: hoursAgo(500) })], NOW)?.status).toBe('pending');
  });

  it('shows a decline that just happened', () => {
    expect(openCreditRequest([declined(1)], NOW)?.status).toBe('rejected');
  });

  // The bug: it used to sit there until the player submitted another request,
  // which for someone who reads the reason and lets it go is forever.
  it('DROPS a decline once it is a day old', () => {
    expect(openCreditRequest([declined(DECLINED_NOTICE_HOURS + 1)], NOW)).toBeUndefined();
  });

  it('holds it right up to the cutoff, and drops it just past', () => {
    expect(openCreditRequest([declined(DECLINED_NOTICE_HOURS - 0.1)], NOW)?.status).toBe('rejected');
    expect(openCreditRequest([declined(DECLINED_NOTICE_HOURS + 0.1)], NOW)).toBeUndefined();
  });

  // The window is measured from the DECLINE, not from when the player asked. A
  // request submitted a week ago and declined an hour ago is news.
  it('measures from when it was declined, not when it was made', () => {
    const old = declined(1, { createdAt: hoursAgo(200) });
    expect(openCreditRequest([old], NOW)?.status).toBe('rejected');
  });

  it('shows nothing for an approved request — the credits speak for themselves', () => {
    expect(openCreditRequest([req({ status: 'approved', resolvedAt: hoursAgo(1) })], NOW)).toBeUndefined();
  });

  it('shows nothing at all when there are no requests', () => {
    expect(openCreditRequest([], NOW)).toBeUndefined();
  });

  // Newest-first ordering is the contract (fetchMyCreditRequests orders by
  // created_at desc). Only the head is considered for a decline: an older one
  // behind a newer request is not the latest news.
  it('ignores an old decline sitting behind a newer approved request', () => {
    const list = [req({ id: 'cr_new' as CreditRequestId, status: 'approved', resolvedAt: hoursAgo(1) }), declined(2)];
    expect(openCreditRequest(list, NOW)).toBeUndefined();
  });

  it('prefers a pending request over a recent decline, wherever it sits', () => {
    const list = [declined(1), req({ id: 'cr_pending' as CreditRequestId })];
    expect(openCreditRequest(list, NOW)?.id).toBe('cr_pending');
  });

  // Defence only — the resolution-shape CHECK makes this row impossible. The
  // fallback errs towards retiring the notice early, never towards it lingering.
  it('falls back to createdAt if a rejected row somehow has no resolvedAt', () => {
    const noResolved = req({ status: 'rejected', resolvedAt: null, createdAt: hoursAgo(1) });
    expect(openCreditRequest([noResolved], NOW)?.status).toBe('rejected');
    const stale = req({ status: 'rejected', resolvedAt: null, createdAt: hoursAgo(48) });
    expect(openCreditRequest([stale], NOW)).toBeUndefined();
  });
});
