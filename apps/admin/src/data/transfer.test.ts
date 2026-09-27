import { mockLocations } from '@tpa/mocks';
import type { CreditBatch, IsoInstant, Location, LocationId, PlayerId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import type { TransferReason } from '../lib/api';
import { canTransferBatch, transferTargets, TRANSFER_ERROR } from './transfer';

const NOW = '2026-09-27T12:00:00.000Z' as IsoInstant;

const loc = (id: string, name: string, isActive = true, sortOrder = 0): Location => ({
  id: id as LocationId,
  name,
  address: 'x',
  mapsUrl: 'https://maps.example/x',
  hoursText: 'Daily',
  sortOrder,
  isActive,
  isDefault: false,
  createdAt: mockLocations[0]!.createdAt,
});

const ORO = loc('loc_oro', 'Oro Plaza', true, 0);
const QA = loc('loc_qa', 'QA Branch', true, 1);
const SHUT = loc('loc_shut', 'Closed', false, 2);

const batch = (over: Partial<CreditBatch> = {}): CreditBatch => ({
  id: 'cb_1' as CreditBatch['id'],
  locationId: ORO.id,
  playerId: 'pl_1' as PlayerId,
  source: 'admin_grant',
  purchaseId: null,
  transferredFrom: null,
  trainingType: 'group',
  quantityTotal: 4,
  quantityRemaining: 2,
  expiresAt: '2026-12-01T00:00:00.000Z' as IsoInstant,
  createdAt: '2026-09-01T00:00:00.000Z' as IsoInstant,
  note: null,
  ...over,
});

describe('canTransferBatch', () => {
  it('allows a live batch with credits left', () => {
    expect(canTransferBatch(batch(), NOW)).toBe(true);
  });

  // Mirrors the RPC's own refusals, so the button is absent rather than
  // present-and-refusing.
  it('refuses a spent batch', () => {
    expect(canTransferBatch(batch({ quantityRemaining: 0 }), NOW)).toBe(false);
  });

  it('refuses an expired batch — a move must never resurrect dead credits', () => {
    expect(canTransferBatch(batch({ expiresAt: '2026-09-01T00:00:00.000Z' as IsoInstant }), NOW)).toBe(false);
  });

  it('treats expiry as strict — a batch expiring exactly now is not movable', () => {
    expect(canTransferBatch(batch({ expiresAt: NOW }), NOW)).toBe(false);
  });
});

describe('transferTargets', () => {
  it('excludes the branch the batch is already at', () => {
    expect(transferTargets([ORO, QA], batch()).map((l) => l.id)).toEqual([QA.id]);
  });

  it('excludes CLOSED branches — credits moved there could not be used', () => {
    expect(transferTargets([ORO, QA, SHUT], batch()).map((l) => l.id)).toEqual([QA.id]);
  });

  it('is empty when there is nowhere else to go', () => {
    expect(transferTargets([ORO], batch())).toEqual([]);
  });
});

describe('TRANSFER_ERROR', () => {
  it('has real copy for every reason transfer_credit_batch can return', () => {
    const reasons: (TransferReason | 'network')[] = [
      'not_admin', 'reason_required', 'quantity_below_one', 'batch_missing', 'expired',
      'player_missing', 'same_location', 'location_missing', 'location_inactive',
      'quantity_above_remaining', 'network',
    ];
    for (const r of reasons) {
      expect(TRANSFER_ERROR[r].length).toBeGreaterThan(10);
    }
  });

  it('never reuses the generic message for a known reason', () => {
    const known = Object.entries(TRANSFER_ERROR).filter(([k]) => k !== 'network');
    for (const [, copy] of known) expect(copy).not.toBe(TRANSFER_ERROR.network);
  });
});
