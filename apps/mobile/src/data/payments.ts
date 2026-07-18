import { toInstant } from '@tpa/core';
import type { Package, Player } from '@tpa/types';
import * as WebBrowser from 'expo-web-browser';

import { createCheckout, insertPendingPurchase } from '../lib/api';

/**
 * THE PAYMENT SEAM — now real (S6, Paymob). No more client-only overlay. The flow:
 *  1. insert a PENDING purchase (RLS pins amount = active price, player = caller);
 *  2. ask the create-checkout Edge Function for a Paymob checkout URL;
 *  3. open that URL in the browser and let the user pay.
 *
 * We NEVER mint credits here. The Paymob webhook (service_role, after HMAC) settles
 * the purchase and mints the credits server-side. So this returns only the
 * purchaseId; the caller routes to purchase-success, which POLLS the purchase until
 * the webhook confirms it — the return journey. The webhook is the source of truth,
 * so we don't depend on any redirect scheme: dismissing the sheet just starts the poll.
 */
export type PayResult = { ok: true; purchaseId: string } | { ok: false; error: string };

export async function payForPackage(player: Player, pkg: Package): Promise<PayResult> {
  try {
    const now = toInstant(new Date());
    const purchaseId = await insertPendingPurchase(player.id, pkg.id, pkg.price, now);
    const checkoutUrl = await createCheckout(purchaseId);
    await WebBrowser.openBrowserAsync(checkoutUrl);
    return { ok: true, purchaseId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Payment could not be started.' };
  }
}
