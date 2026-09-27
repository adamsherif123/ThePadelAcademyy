import type { CreditBatch, IsoInstant, Location, LocationId } from '@tpa/types';

import { transferCreditBatchRpc, type TransferReason, type TransferResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';
import { activeLocations } from './useSelectedLocation';

/**
 * Move some of a player's remaining credits to another branch — goodwill when a
 * court closes or a player moves across town (067).
 *
 * A SECURITY DEFINER RPC for the same reason grant_credits is one: credit_batches
 * has no admin write policy. It never extends expiry and never creates value —
 * the quantity comes out of the source batch before it goes into the new one.
 */
export function transferCreditBatch(
  batchId: CreditBatch['id'],
  toLocationId: LocationId,
  quantity: number,
  note: string,
): Promise<TransferResult | { ok: false; reason: 'network' }> {
  return runRpc(() => transferCreditBatchRpc(batchId, toLocationId, quantity, note), TOUCHED.transfer);
}

/**
 * Every refusal transfer_credit_batch can give, in the admin's words. Exhaustive
 * by construction (`Record<TransferReason, …>`), so a new reason on the server
 * fails the build here rather than showing a player-facing shrug.
 */
export const TRANSFER_ERROR: Record<TransferReason | 'network', string> = {
  not_admin: "You don't have permission to move credits.",
  reason_required: 'Add a short reason — it goes on the player’s record.',
  quantity_below_one: 'Move at least one credit.',
  batch_missing: 'Those credits no longer exist.',
  expired: 'These credits have expired, so they can’t be moved. Grant new ones instead.',
  player_missing: 'That player’s account has been deleted.',
  same_location: 'They’re already at that location — pick a different one.',
  location_missing: 'That location no longer exists.',
  location_inactive: 'That location is closed, so credits moved there couldn’t be used.',
  quantity_above_remaining: 'That’s more than this batch has left.',
  network: 'Something went wrong. Please try again.',
};

/**
 * Whether the "Move to another location" action belongs on a batch at all.
 *
 * Mirrors the RPC's own refusals so the button is absent rather than present-
 * and-refusing: nothing left to move, or already expired. `now` is passed in
 * (never read from the clock here) so the rule is testable.
 */
export function canTransferBatch(batch: CreditBatch, now: IsoInstant): boolean {
  return batch.quantityRemaining > 0 && batch.expiresAt > now;
}

/**
 * Where a batch may be moved TO: active branches, minus the one it is already at.
 * Reuses the Schedule picker's ordering so the branch list reads the same
 * everywhere in the app.
 */
export function transferTargets(locations: readonly Location[], batch: CreditBatch): Location[] {
  return activeLocations(locations).filter((l) => l.id !== batch.locationId);
}
