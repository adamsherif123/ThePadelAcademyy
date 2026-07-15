import {
  canBookSlot,
  formatExpiry,
  formatPiastres,
  slotRemainingCapacity,
} from '@tpa/core';
import { describe, expect, it } from 'vitest';

import {
  MOCK_NOW,
  mockBookings,
  mockCreditBatches,
  mockCurrentPlayer,
  mockPackages,
  mockPurchases,
  mockSlots,
} from './index';

describe('catalog', () => {
  it('has the academy pricing in integer piastres', () => {
    const byId = Object.fromEntries(mockPackages.map((p) => [p.id, p]));
    expect(formatPiastres(byId['pk_group_4']!.price)).toBe('1,600 EGP');
    expect(formatPiastres(byId['pk_indiv_8']!.price)).toBe('6,000 EGP');
    expect(formatPiastres(byId['pk_duo_1']!.price)).toBe('600 EGP');
    expect(byId['pk_group_4']!.price).toBe(160000); // no floats
  });
});

describe('purchases and bookings cover every status', () => {
  it('has each PurchaseStatus', () => {
    expect(new Set(mockPurchases.map((p) => p.status))).toEqual(
      new Set(['pending', 'succeeded', 'failed']),
    );
  });
  it('has each BookingStatus', () => {
    expect(new Set(mockBookings.map((b) => b.status))).toEqual(
      new Set(['booked', 'cancelled', 'attended', 'no_show']),
    );
  });
  it('every booking references a real slot', () => {
    const slotIds = new Set(mockSlots.map((s) => s.id));
    for (const b of mockBookings) expect(slotIds.has(b.slotId)).toBe(true);
  });
});

describe('wallet expiry states (rendered via core against MOCK_NOW)', () => {
  it('includes a batch expiring in 2 days and one already expired', () => {
    const rendered = mockCreditBatches.map((b) => formatExpiry(b.expiresAt, MOCK_NOW));
    expect(rendered).toContain('expires in 2 days');
    expect(rendered).toContain('expired');
  });
});

describe('slots', () => {
  const nowMs = new Date(MOCK_NOW).getTime();
  it('span past and future', () => {
    expect(mockSlots.some((s) => new Date(s.startsAt).getTime() < nowMs)).toBe(true);
    expect(mockSlots.some((s) => new Date(s.startsAt).getTime() > nowMs)).toBe(true);
  });
  it('include empty, partly-booked, full, and cancelled cases', () => {
    expect(mockSlots.some((s) => s.status === 'published' && s.bookedCount === 0)).toBe(true);
    expect(
      mockSlots.some((s) => s.bookedCount > 0 && s.bookedCount < s.capacity),
    ).toBe(true);
    expect(mockSlots.some((s) => slotRemainingCapacity(s) === 0 && s.status === 'published')).toBe(
      true,
    );
    expect(mockSlots.some((s) => s.status === 'cancelled')).toBe(true);
  });
  it('cover the full training-type mix', () => {
    expect(new Set(mockSlots.map((s) => s.trainingType))).toEqual(
      new Set(['trial', 'group', 'duo', 'individual']),
    );
  });
  it('the current player can book at least one upcoming group slot', () => {
    const bookable = mockSlots.filter(
      (s) =>
        s.trainingType === 'group' &&
        canBookSlot(s, mockCurrentPlayer, mockCreditBatches, MOCK_NOW).ok,
    );
    expect(bookable.length).toBeGreaterThan(0);
  });
});
