import {
  mockBookings,
  mockCoaches,
  mockCreditBatches,
  mockPackages,
  mockPlayers,
  mockPurchases,
  mockSlots,
  mockTemplates,
} from '@tpa/mocks';
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CreditBatch,
  Package,
  Player,
  Purchase,
  SessionSlot,
} from '@tpa/types';
import { useSyncExternalStore } from 'react';

/**
 * The admin's mutable data store, seeded from @tpa/mocks. Deliberately its OWN
 * store, not shared with the mobile app: the two runtimes diverge (the client
 * BOOKS its own seats; the admin CANCELS sessions and MARKS attendance), the
 * mechanics are ~30 lines, and S9/S10 replace both with Supabase anyway — so
 * extracting a shared package now would risk the wrong abstraction for a copy of
 * boilerplate.
 *
 * Shaped like a data source, not app state: pure selectors in data/* read the
 * getters; components subscribe with `useAdminStore()`. S10 swaps these internals
 * for Supabase queries (getters) + a realtime/refetch signal (subscription)
 * without touching selectors or screens. This session is read-only; the cancel /
 * attendance mutation seams land with their screens (S4c onward).
 */
let coaches: Coach[] = [...mockCoaches];
let players: Player[] = [...mockPlayers];
let slots: SessionSlot[] = [...mockSlots];
let templates: AvailabilityTemplate[] = [...mockTemplates];
let bookings: Booking[] = [...mockBookings];
let packages: Package[] = [...mockPackages];
let purchases: Purchase[] = [...mockPurchases];
let batches: CreditBatch[] = [...mockCreditBatches];

let version = 0;
const listeners = new Set<() => void>();

/** Bump the version and notify subscribers. Used by the S4c+ mutation seams. */
export function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export const getCoaches = (): Coach[] => coaches;
export const getPlayers = (): Player[] => players;
export const getSlots = (): SessionSlot[] => slots;
export const getTemplates = (): AvailabilityTemplate[] => templates;
export const getBookings = (): Booking[] => bookings;
export const getPackages = (): Package[] => packages;
export const getPurchases = (): Purchase[] => purchases;
export const getBatches = (): CreditBatch[] => batches;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to store changes; returns the version counter. */
export function useAdminStore(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

/** TEST-ONLY: re-seed from the fixtures so tests start clean (mirrors mobile). */
export function __resetStoreForTests(): void {
  coaches = [...mockCoaches];
  players = [...mockPlayers];
  slots = [...mockSlots];
  templates = [...mockTemplates];
  bookings = [...mockBookings];
  packages = [...mockPackages];
  purchases = [...mockPurchases];
  batches = [...mockCreditBatches];
  version = 0;
}
