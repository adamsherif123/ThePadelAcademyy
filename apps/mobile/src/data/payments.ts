import { toInstant } from '@tpa/core';
import type { Package, Player } from '@tpa/types';
import * as WebBrowser from 'expo-web-browser';

import { createCheckout, insertPendingPurchase } from '../lib/api';

/**
 * THE PAYMENT SEAM — real (S6, Paymob); S6.1 adds the decline outcome. The flow:
 *  1. insert a PENDING purchase (RLS pins amount = active price, player = caller);
 *  2. ask the create-checkout Edge Function for a Paymob checkout URL;
 *  3. open it in the in-app browser and let the user pay.
 *
 * We NEVER mint credits here, and we NEVER trust the outcome for anything but which
 * screen to show first. The Paymob webhook (service_role, after HMAC) is the source
 * of truth: it settles → succeeded (mints) or → failed (mints nothing). So we return
 * the purchaseId plus an `outcome` HINT for the return screen:
 *   'success' / 'failure' → show that screen instantly (still confirmed by the server);
 *   'dismissed'           → we learned nothing from the browser; the return screen
 *                            polls the webhook-written status (succeeded / failed /
 *                            still-pending timeout).
 *
 * FAST-PATH REDIRECT (not active yet): reading 'success'/'failure' from the browser
 * requires Paymob's Transaction Response Callback to deep-link back to the app scheme
 * (tpa://) and openAuthSessionAsync to capture it. That deep-link can't be verified
 * headlessly and rewiring the response callback would risk the device-proven success
 * flow, so we keep openBrowserAsync and return 'dismissed' — the poll reads the same
 * durable status a beat later. The return screen already consumes `outcome`, so the
 * instant path lights up the moment the response callback is pointed at tpa://.
 */
export type PayOutcome = 'success' | 'failure' | 'dismissed';
export type PayResult =
  | { ok: true; purchaseId: string; outcome: PayOutcome }
  | { ok: false; error: string };

export async function payForPackage(player: Player, pkg: Package): Promise<PayResult> {
  try {
    const now = toInstant(new Date());
    const purchaseId = await insertPendingPurchase(player.id, pkg.id, pkg.price, now);
    const checkoutUrl = await createCheckout(purchaseId);
    await WebBrowser.openBrowserAsync(checkoutUrl);
    // The in-app browser hands back no URL, so we don't know the outcome yet — the
    // return screen polls the webhook-written status. (See FAST-PATH REDIRECT above.)
    return { ok: true, purchaseId, outcome: 'dismissed' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Payment could not be started.' };
  }
}
