import type { Gender, IsoInstant, Level, Player, PlayerId, Purchase } from '@tpa/types';

import { usableCreditFor } from './selectors';
import { commitPlayerSave, getBatches, getBookings, getPlayers, getPurchases, getSlots } from './store';

/**
 * Player selectors + the profile-edit seam. Pure reads over the store; S10 swaps
 * the store internals for Supabase unchanged. The profile write is is_admin-gated
 * config (not money), so S10 replaces it with a plain UPDATE.
 */

const ms = (i: IsoInstant): number => new Date(i).getTime();

export interface CreditBreakdown {
  /** Usable G + D + I credits (the list row's headline; trial is not a bought type). */
  total: number;
  group: number;
  duo: number;
  individual: number;
}

/** The G · D · I usable-credit breakdown shown on the Players list. */
export function creditBreakdown(playerId: PlayerId, now: IsoInstant): CreditBreakdown {
  const group = usableCreditFor(playerId, 'group', now);
  const duo = usableCreditFor(playerId, 'duo', now);
  const individual = usableCreditFor(playerId, 'individual', now);
  return { total: group + duo + individual, group, duo, individual };
}

/** Every credit batch a player holds, newest first (for the wallet in player detail). */
export const batchesForPlayerSorted = (playerId: PlayerId) =>
  getBatches()
    .filter((b) => b.playerId === playerId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

/** A player's purchases, newest first (for purchase history). */
export const purchasesForPlayer = (playerId: PlayerId): Purchase[] =>
  getPurchases()
    .filter((p) => p.playerId === playerId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

/**
 * Active bookings this player holds on GROUP slots whose gender/level wouldn't
 * match a proposed profile — surfaced when the owner edits gender/level, so the
 * change is made with eyes open. The bookings themselves are never touched.
 */
export function mismatchedActiveBookings(
  playerId: PlayerId,
  gender: Gender,
  level: Level,
): number {
  const slotById = new Map(getSlots().map((s) => [s.id, s]));
  return getBookings().filter((b) => {
    if (b.playerId !== playerId || b.status !== 'booked') return false;
    const slot = slotById.get(b.slotId);
    if (!slot || slot.trainingType !== 'group') return false;
    return (slot.gender !== null && slot.gender !== gender) || (slot.level !== null && slot.level !== level);
  }).length;
}

// --- Profile edit seam ---
export interface PlayerProfilePatch {
  name: string;
  phone: string;
  gender: Gender;
  level: Level;
}

export type UpdatePlayerResult =
  | { ok: true; player: Player }
  | { ok: false; reason: 'player_missing' | 'name_required' | 'phone_required' };

/**
 * Edit a player's profile. Gender/level are editable — a player mis-signed-up, or
 * got re-assessed — and this changes which group slots they SEE going forward. It
 * does NOT touch bookings they already hold: a seat already taken (credit already
 * spent) stays valid even if the slot no longer matches the new profile. The UI
 * surfaces mismatchedActiveBookings so the owner sees that before saving.
 */
export function updatePlayerProfile(playerId: PlayerId, patch: PlayerProfilePatch): UpdatePlayerResult {
  const current = getPlayers().find((p) => p.id === playerId);
  if (!current) return { ok: false, reason: 'player_missing' };
  if (patch.name.trim() === '') return { ok: false, reason: 'name_required' };
  if (patch.phone.trim() === '') return { ok: false, reason: 'phone_required' };
  const updated: Player = {
    ...current,
    name: patch.name.trim(),
    phone: patch.phone.trim(),
    gender: patch.gender,
    level: patch.level,
  };
  commitPlayerSave(updated);
  return { ok: true, player: updated };
}
