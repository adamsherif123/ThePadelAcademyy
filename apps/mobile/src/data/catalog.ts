import { TRAINING_TYPES } from '@tpa/core';
import { mockPackages } from '@tpa/mocks';
import type { Package, PackageId, TrainingType } from '@tpa/types';

/**
 * Catalog selectors over @tpa/mocks. The catalog is static (packages don't change
 * on purchase), so these read the fixtures directly. Pure; S9 swaps the bodies.
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

export function activePackages(): Package[] {
  return mockPackages.filter((p) => p.isActive);
}

/** Active packages for one training type, cheapest first. */
export function packagesByType(type: TrainingType): Package[] {
  return activePackages()
    .filter((p) => p.trainingType === type)
    .sort((a, b) => a.sessionCount - b.sessionCount);
}

export function packageById(id: PackageId): Package | undefined {
  return mockPackages.find((p) => p.id === id);
}

/** Per-session unit price in piastres (for "N EGP / session"). */
export function perSessionPiastres(pkg: Package): number {
  return Math.round(pkg.price / pkg.sessionCount);
}

/** The best-value marker in the design: 8-session bundles. */
export function isBestValue(pkg: Package): boolean {
  return pkg.sessionCount === 8;
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
