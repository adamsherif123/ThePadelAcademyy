import { TRAINING_TYPES } from '@tpa/core';
import type { Location, LocationId, Package, PackageId, Piastres, TrainingType } from '@tpa/types';

/**
 * Catalog selectors — pure functions of a package list. The list is the active
 * packages read from Supabase (RLS exposes only active ones to players), passed in
 * by the query layer (S9). Pure; the derivations (sorting, per-session price, the
 * "what's included" copy) are unchanged.
 */

/** Purchasable training types — everything except trial (trials are only granted). */
export const PURCHASABLE_TYPES: TrainingType[] = TRAINING_TYPES.filter((t) => t !== 'trial');

/** Player-count copy per training type (shown on buy-credits sections / detail). */
export const PLAYER_COUNT: Record<TrainingType, string> = {
  trial: '1 player',
  group: '3–4 players',
  duo: '2 players',
  individual: '1 player',
};

export function activePackages(packages: Package[]): Package[] {
  return packages.filter((p) => p.isActive);
}

/**
 * Active packages sold at ONE branch.
 *
 * Load-bearing, not cosmetic. A 1.4 client can see every branch's catalog, and a
 * package's credits are only spendable where it was bought (065) — so an unfiltered
 * list would let a player standing at Branch A buy credits for Branch B, with
 * nothing on the row to warn them. `locationId` null means "not resolved yet";
 * showing nothing is the safe answer for the instant before locations load.
 */
export function packagesAtLocation(packages: Package[], locationId: LocationId | null): Package[] {
  if (locationId === null) return [];
  return activePackages(packages).filter((p) => p.locationId === locationId);
}

/** Active packages for one training type, cheapest first. */
export function packagesByType(packages: Package[], type: TrainingType): Package[] {
  return activePackages(packages)
    .filter((p) => p.trainingType === type)
    .sort((a, b) => a.sessionCount - b.sessionCount);
}

export function packageById(packages: Package[], id: PackageId): Package | undefined {
  return packages.find((p) => p.id === id);
}

/** Per-session unit price in piastres (for "N EGP / session"). */
export function perSessionPiastres(pkg: Package): number {
  return Math.round(pkg.price / pkg.sessionCount);
}

const PLAYER_INCLUSION: Record<TrainingType, string> = {
  trial: '1-on-1 with a coach',
  group: '3–4 players per session',
  duo: '2 players — each books & pays separately',
  individual: '1-on-1 with your coach',
};

/** The "what's included" checklist for a package (derived from its type/count). */
export function packageIncludes(pkg: Package): string[] {
  const type = TRAINING_META_LABEL[pkg.trainingType];
  return [
    `${pkg.sessionCount} × ${type} training sessions`,
    PLAYER_INCLUSION[pkg.trainingType],
    'Certified academy coaches',
    '1 credit = 1 session, loaded instantly',
    `${type} credits book ${type} sessions only`,
  ];
}

// Local label map (kept in the data layer to avoid a ui import from data).
const TRAINING_META_LABEL: Record<TrainingType, string> = {
  trial: 'Trial',
  group: 'Group',
  duo: 'Duo',
  individual: 'Individual',
};

// ── the trial, per branch (S8.7) ─────────────────────────────────────────────
// Each branch sells its own trial package, and the PACKAGE decides where the
// credits will work (tpa.force_location_from_package). So "which branch do I want
// my trial at" is really "which branch's trial package am I requesting" — there is
// no separate branch field to set, and nothing here needs a migration.

/** The one active trial package at a branch, or null if that branch sells none. */
export function trialPackageAt(packages: Package[], locationId: LocationId | null): Package | null {
  return packagesAtLocation(packages, locationId).find((p) => p.trainingType === 'trial') ?? null;
}

/**
 * The branches a new player may choose between for their trial: active, in toggle
 * order, AND selling an active trial. A branch with no trial package is not an
 * option — offering it would mean a picker entry that produces `package_missing`.
 *
 * `locations` is expected to be the full list; it is filtered and ordered here by
 * the same rule the location toggle uses, so the two never disagree about which
 * branches exist or in what order.
 */
export function trialBranches(packages: Package[], locations: readonly Location[]): Location[] {
  return locations
    .filter((l) => l.isActive)
    .filter((l) => trialPackageAt(packages, l.id) !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * Which branch the picker opens on.
 *
 * The player's current selection wins when it sells a trial — they have already
 * told the app where they are, and asking again with a different answer
 * pre-filled would be the app arguing with them. Otherwise the first eligible
 * branch, which is the default branch whenever it qualifies (sort_order 0).
 */
export function defaultTrialBranch(
  branches: readonly Location[],
  selectedId: LocationId | null,
): Location | null {
  return branches.find((l) => l.id === selectedId) ?? branches[0] ?? null;
}

/**
 * The price to advertise before a branch has been chosen — the welcome screen's
 * chip, which is shown while the player is still deciding.
 *
 * One price across the eligible branches is stated flatly. Two different prices
 * cannot be, so it becomes "from <lowest>": quoting either one as THE price would
 * be wrong for somebody, and the lowest is the only figure that is never an
 * unpleasant surprise. Null when nothing is on offer.
 */
export function trialPriceRange(
  packages: Package[],
  locations: readonly Location[],
): { lowest: Piastres; varies: boolean } | null {
  const prices = trialBranches(packages, locations)
    .map((l) => trialPackageAt(packages, l.id)?.price)
    .filter((p): p is Piastres => p != null);
  if (prices.length === 0) return null;
  const lowest = prices.reduce((a, b) => (b < a ? b : a));
  return { lowest, varies: prices.some((p) => p !== lowest) };
}
