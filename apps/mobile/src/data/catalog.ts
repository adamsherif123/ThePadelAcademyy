import { TRAINING_TYPES } from '@tpa/core';
import type { Package, PackageId, TrainingType } from '@tpa/types';

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
