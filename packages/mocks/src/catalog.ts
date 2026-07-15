import type { Package, PackageId } from '@tpa/types';

import { egp } from './now';

/**
 * The academy's real published pricing (per person). Money is integer piastres,
 * built via egp().
 *
 *   Trial:      1 session   500
 *   Group:      4 sessions 1,600 · 8 sessions 2,800
 *   Duo:        1 session   600 · 4 sessions 2,200 · 8 sessions 4,000
 *   Individual: 1 session 1,000 · 4 sessions 3,200 · 8 sessions 6,000
 *
 * ⚠️ ASSUMPTION (pk_group_1, flagged for the architect): the site advertises
 * Group "From 500 EGP / Person" but lists only 4- and 8-session bundles. We assume
 * a 1-session Group at 500 EGP. Confirm with the academy; adjust or remove.
 */
export const mockPackages: Package[] = [
  { id: 'pk_trial_1' as PackageId, trainingType: 'trial', sessionCount: 1, price: egp(500), name: 'Trial Session', isActive: true },

  { id: 'pk_group_1' as PackageId, trainingType: 'group', sessionCount: 1, price: egp(500), name: 'Group · 1 Session', isActive: true }, // ASSUMED
  { id: 'pk_group_4' as PackageId, trainingType: 'group', sessionCount: 4, price: egp(1600), name: 'Group · 4 Sessions', isActive: true },
  { id: 'pk_group_8' as PackageId, trainingType: 'group', sessionCount: 8, price: egp(2800), name: 'Group · 8 Sessions', isActive: true },

  { id: 'pk_duo_1' as PackageId, trainingType: 'duo', sessionCount: 1, price: egp(600), name: 'Duo · 1 Session', isActive: true },
  { id: 'pk_duo_4' as PackageId, trainingType: 'duo', sessionCount: 4, price: egp(2200), name: 'Duo · 4 Sessions', isActive: true },
  { id: 'pk_duo_8' as PackageId, trainingType: 'duo', sessionCount: 8, price: egp(4000), name: 'Duo · 8 Sessions', isActive: true },

  { id: 'pk_indiv_1' as PackageId, trainingType: 'individual', sessionCount: 1, price: egp(1000), name: 'Individual · 1 Session', isActive: true },
  { id: 'pk_indiv_4' as PackageId, trainingType: 'individual', sessionCount: 4, price: egp(3200), name: 'Individual · 4 Sessions', isActive: true },
  { id: 'pk_indiv_8' as PackageId, trainingType: 'individual', sessionCount: 8, price: egp(6000), name: 'Individual · 8 Sessions', isActive: true },
];

/** The 1-session Group package assumed from the site's ambiguous "From 500" copy. */
export const ASSUMED_PACKAGE_IDS = ['pk_group_1'] as const;
