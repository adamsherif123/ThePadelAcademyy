import type { Package, Purchase } from '@tpa/types';

import { packageById } from './catalog';

/**
 * Purchase-history derivations — pure over the purchases list (the player's own,
 * scoped by RLS, merged with any mock-purchase overlay by the query layer). The
 * payment seam itself lives in ./mockPayments (payForPackage).
 */

/** The current player's purchases, newest first. */
export function playerPurchases(purchases: Purchase[]): Purchase[] {
  return [...purchases].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Resolve the package a purchase was for (for history rows). */
export function packageForPurchase(packages: Package[], purchase: Purchase): Package | undefined {
  return packageById(packages, purchase.packageId);
}
