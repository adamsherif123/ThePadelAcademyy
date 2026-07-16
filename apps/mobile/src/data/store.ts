import { mockBookings, mockCreditBatches, mockPurchases, mockSlots } from '@tpa/mocks';
import type { Booking, CreditBatch, Purchase, SessionSlot } from '@tpa/types';
import { useSyncExternalStore } from 'react';

/**
 * Mutable data store layered over the static @tpa/mocks fixtures, so demo
 * purchases grant credits and demo bookings spend them — and the Wallet / Home /
 * Book / History screens all update live.
 *
 * It is deliberately shaped like a data source, not app state: the pure selectors
 * in data/* read the getters, and screens subscribe with `useDataStore()`. S9
 * replaces this file's internals with Supabase (queries for the getters, a
 * realtime/refetch signal for the subscription) — selectors and screens unchanged.
 */
let batches: CreditBatch[] = [...mockCreditBatches];
let purchases: Purchase[] = [...mockPurchases];
let slots: SessionSlot[] = [...mockSlots];
let bookings: Booking[] = [...mockBookings];

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

export function getSlots(): SessionSlot[] {
  return slots;
}

export function getBookings(): Booking[] {
  return bookings;
}

/** Record a completed purchase and grant its credits (newest first). */
export function commitPurchase(purchase: Purchase, batch: CreditBatch): void {
  purchases = [purchase, ...purchases];
  batches = [batch, ...batches];
  emit();
}

/**
 * Record a booking: replace the spent batch (decremented) and the slot (one more
 * seat taken) in place, and prepend the new booking. Callers pass the already-
 * computed next-state objects so this stays a dumb, atomic commit — the booking
 * rules live in @tpa/core and the mutation seam (bookSlot).
 */
export function commitBooking(
  booking: Booking,
  updatedBatch: CreditBatch,
  updatedSlot: SessionSlot,
): void {
  batches = batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b));
  slots = slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s));
  bookings = [booking, ...bookings];
  emit();
}

/**
 * Record a cancellation: replace the booking (now `cancelled`) and the slot (one
 * seat freed) in place, and — only when the cancellation is refundable —
 * replace the credited batch (one credit returned). The seat is ALWAYS freed;
 * the refund is optional, so `updatedBatch` is omitted on a forfeit. Like
 * commitBooking, this is a dumb atomic commit: the rules (and whether a refund
 * happens at all) are decided by @tpa/core + the cancelBooking seam.
 */
export function commitCancellation(
  booking: Booking,
  updatedSlot: SessionSlot,
  updatedBatch?: CreditBatch,
): void {
  bookings = bookings.map((b) => (b.id === booking.id ? booking : b));
  slots = slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s));
  if (updatedBatch) batches = batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b));
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe the calling component to store changes. Returns the version counter;
 * components then call the pure selectors. Screens showing mutable data (Home,
 * Wallet, Book, Profile, Purchase history) call this so they re-render after a
 * purchase or booking.
 */
export function useDataStore(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
