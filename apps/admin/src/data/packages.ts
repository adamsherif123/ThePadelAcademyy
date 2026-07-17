import { ID_PREFIXES, TRAINING_TYPES, newId } from '@tpa/core';
import type { Package, PackageId, Piastres, TrainingType } from '@tpa/types';

import { commitPackageSave, getPackages } from './store';

/**
 * Package selectors + the package CRUD seam. Writes are is_admin-gated config (not
 * money → no RPC), so S10 swaps them for plain INSERT/UPDATE. Packages are never
 * deleted — sold credits reference them and stay valid until they expire — so
 * "retire" is isActive:false (Hidden). Editing a package changes only price, name,
 * and sellability; trainingType and sessionCount are the bundle's IDENTITY and are
 * locked on edit, which keeps historical reads (revenue-by-type, purchase labels)
 * honest without those callers having to reach for captured values.
 */

/**
 * The training types a package may have. Trial is EXCLUDED structurally — the app
 * has no concept of buying a trial (S1.5 deleted the trial package deliberately;
 * trial credits are only ever granted free at signup). The New-package type picker
 * is built from this list, so "a trial package" is not expressible in the UI, and
 * the seam rejects it as a backstop.
 */
export const SELLABLE_TYPES: readonly TrainingType[] = TRAINING_TYPES.filter((t) => t !== 'trial');

/** Round-to-nearest-piastre per-session price (informational; matches liability rounding). */
export function perSessionPrice(pkg: Package): Piastres {
  if (pkg.sessionCount <= 0) return 0 as Piastres;
  return Math.round(pkg.price / pkg.sessionCount) as Piastres;
}

/** "Single group session" / "8-session group pack" — a package one-liner for the stat cards. */
export function packageDescriptor(pkg: Package): string {
  return pkg.sessionCount === 1
    ? `Single ${pkg.trainingType} session`
    : `${pkg.sessionCount}-session ${pkg.trainingType} pack`;
}

export interface CatalogStats {
  activeCount: number;
  totalCount: number;
  lowestEntry: { price: Piastres; descriptor: string } | null;
  bestValue: { perSession: Piastres; descriptor: string } | null;
}

/** The three headline stats — all derived from the active catalog, never hardcoded. */
export function catalogStats(): CatalogStats {
  const all = getPackages();
  const active = all.filter((p) => p.isActive);
  if (active.length === 0) {
    return { activeCount: 0, totalCount: all.length, lowestEntry: null, bestValue: null };
  }
  const cheapest = active.reduce((a, b) => (b.price < a.price ? b : a));
  // Compare the exact per-session rate to pick the true best; display it rounded.
  const best = active.reduce((a, b) => (b.price / b.sessionCount < a.price / a.sessionCount ? b : a));
  return {
    activeCount: active.length,
    totalCount: all.length,
    lowestEntry: { price: cheapest.price, descriptor: packageDescriptor(cheapest) },
    bestValue: { perSession: perSessionPrice(best), descriptor: packageDescriptor(best) },
  };
}

/** Active-and-inactive packages of a type, cheapest bundle first (for the sections). */
export function packagesForType(type: TrainingType): Package[] {
  return getPackages()
    .filter((p) => p.trainingType === type)
    .sort((a, b) => a.sessionCount - b.sessionCount);
}

// --- CRUD seam ---

export interface PackageDraft {
  trainingType: TrainingType;
  sessionCount: number;
  price: Piastres;
  name: string;
  isActive: boolean;
}

export type SavePackageResult =
  | { ok: true; pkg: Package }
  | {
      ok: false;
      reason: 'name_required' | 'price_below_one' | 'sessions_below_one' | 'trial_not_sellable' | 'package_missing';
    };

function validate(draft: PackageDraft): SavePackageResult | null {
  if (draft.name.trim() === '') return { ok: false, reason: 'name_required' };
  if (draft.trainingType === 'trial') return { ok: false, reason: 'trial_not_sellable' };
  if (draft.sessionCount < 1) return { ok: false, reason: 'sessions_below_one' };
  if (draft.price < 1) return { ok: false, reason: 'price_below_one' };
  return null;
}

export function createPackage(draft: PackageDraft): SavePackageResult {
  const invalid = validate(draft);
  if (invalid) return invalid;
  const pkg: Package = {
    id: newId(ID_PREFIXES.package) as PackageId,
    trainingType: draft.trainingType,
    sessionCount: Math.floor(draft.sessionCount),
    price: draft.price,
    name: draft.name.trim(),
    isActive: draft.isActive,
  };
  commitPackageSave(pkg);
  return { ok: true, pkg };
}

/**
 * Edit price / name / sellability only. trainingType and sessionCount are the
 * bundle's identity and are taken from the EXISTING package, not the draft — a
 * "Group 8-pack" that already sold credits can't quietly become a 6-pack. Price
 * edits affect only future purchases (existing batches carry captured amounts).
 */
export function updatePackage(id: PackageId, draft: PackageDraft): SavePackageResult {
  const current = getPackages().find((p) => p.id === id);
  if (!current) return { ok: false, reason: 'package_missing' };
  if (draft.name.trim() === '') return { ok: false, reason: 'name_required' };
  if (draft.price < 1) return { ok: false, reason: 'price_below_one' };
  const updated: Package = { ...current, price: draft.price, name: draft.name.trim(), isActive: draft.isActive };
  commitPackageSave(updated);
  return { ok: true, pkg: updated };
}

/** Toggle Sellable/Hidden. Hiding never affects credits already sold — they stay valid. */
export function setPackageSellable(id: PackageId, isActive: boolean): SavePackageResult {
  const current = getPackages().find((p) => p.id === id);
  if (!current) return { ok: false, reason: 'package_missing' };
  const updated: Package = { ...current, isActive };
  commitPackageSave(updated);
  return { ok: true, pkg: updated };
}
