import { mockCreditBatches, mockPurchases } from '@tpa/mocks';
import type { CreditBatch, Purchase } from '@tpa/types';
import { useSyncExternalStore } from 'react';

/**
 * Mutable data store layered over the static @tpa/mocks fixtures, so a demo
 * purchase actually grants credits and the Wallet/Home/History screens update.
 *
 * It is deliberately shaped like a data source, not app state: the pure
 * selectors in wallet.ts / schedule.ts read `getBatches()` / `getPurchases()`,
 * and screens subscribe with `useDataStore()`. S9 replaces this file's internals
 * with Supabase (queries for the getters, a realtime/refetch signal for the
 * subscription) — the selectors and screens don't change.
 */
let batches: CreditBatch[] = [...mockCreditBatches];
let purchases: Purchase[] = [...mockPurchases];

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}

export function getBatches(): CreditBatch[] {
  return batches;
}

export function getPurchases(): Purchase[] {
  return purchases;
}

/** Record a completed purchase and grant its credits (newest first). */
export function commitPurchase(purchase: Purchase, batch: CreditBatch): void {
  purchases = [purchase, ...purchases];
  batches = [batch, ...batches];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe the calling component to store changes. Returns the version counter;
 * components then call the pure selectors. Screens showing mutable data (Home,
 * Wallet, Profile, Purchase history) call this so they re-render after a purchase.
 */
export function useDataStore(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
