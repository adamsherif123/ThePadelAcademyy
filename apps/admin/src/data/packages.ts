import { TRAINING_TYPES } from '@tpa/core';
import type { Package, PackageId, Piastres, TrainingType } from '@tpa/types';

import { insertPackage, updatePackage as updatePackageApi } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runWrite } from './queries';

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

/**
 * The retail value of ONE session of a type — for showing the owner what a comp
 * gives away. Prefers the active single-session package's price (the list price of
 * one session); falls back to the cheapest active bundle's per-session rate; null
 * if the type isn't sold at all. Read live on purpose: it's an at-a-glance "worth ~X
 * EGP" for a grant happening now, not a captured figure.
 */
export function sessionRetailValue(packages: Package[], type: TrainingType): Piastres | null {
  const active = packages.filter((p) => p.isActive && p.trainingType === type);
  if (active.length === 0) return null;
  const single = active.find((p) => p.sessionCount === 1);
  if (single) return single.price;
  const best = active.reduce((a, b) => (b.price / b.sessionCount < a.price / a.sessionCount ? b : a));
  return perSessionPrice(best);
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
export function catalogStats(packages: Package[]): CatalogStats {
  const all = packages;
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
export function packagesForType(packages: Package[], type: TrainingType): Package[] {
  return packages
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
      reason:
        | 'name_required' | 'price_below_one' | 'sessions_below_one'
        | 'trial_not_sellable' | 'package_missing' | 'network';
    };

function validate(draft: PackageDraft): SavePackageResult | null {
  if (draft.name.trim() === '') return { ok: false, reason: 'name_required' };
  if (draft.trainingType === 'trial') return { ok: false, reason: 'trial_not_sellable' };
  if (draft.sessionCount < 1) return { ok: false, reason: 'sessions_below_one' };
  if (draft.price < 1) return { ok: false, reason: 'price_below_one' };
  return null;
}

export async function createPackage(draft: PackageDraft): Promise<SavePackageResult> {
  const invalid = validate(draft);
  if (invalid) return invalid;
  const res = await runWrite(
    () => insertPackage({
      trainingType: draft.trainingType, sessionCount: Math.floor(draft.sessionCount),
      price: draft.price, name: draft.name.trim(), isActive: draft.isActive,
    }),
    TOUCHED.packages,
  );
  return res.ok ? { ok: true, pkg: res.value } : { ok: false, reason: 'network' };
}

/**
 * Edit price / name / sellability only. trainingType and sessionCount are the
 * bundle's IDENTITY and are never sent — a "Group 8-pack" that already sold credits
 * can't quietly become a 6-pack. Price edits affect only future purchases (existing
 * batches carry captured amounts).
 */
export async function updatePackage(id: PackageId, draft: PackageDraft): Promise<SavePackageResult> {
  if (draft.name.trim() === '') return { ok: false, reason: 'name_required' };
  if (draft.price < 1) return { ok: false, reason: 'price_below_one' };
  const res = await runWrite(
    () => updatePackageApi(id, { price: draft.price, name: draft.name.trim(), isActive: draft.isActive }),
    TOUCHED.packages,
  );
  return res.ok ? { ok: true, pkg: res.value } : { ok: false, reason: 'network' };
}

/** Toggle Sellable/Hidden. Hiding never affects credits already sold — they stay valid. */
export async function setPackageSellable(id: PackageId, isActive: boolean): Promise<SavePackageResult> {
  const res = await runWrite(() => updatePackageApi(id, { isActive }), TOUCHED.packages);
  return res.ok ? { ok: true, pkg: res.value } : { ok: false, reason: 'network' };
}
