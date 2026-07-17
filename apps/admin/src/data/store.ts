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
/**
 * Seed slots with their bookedCount RECONCILED to the actual active bookings, so
 * the admin has one truth for occupancy — the roster, "X of Y", the calendar
 * badge, and fill rate all agree. (The mobile store keeps the fixtures' preset
 * counts; only the admin, which shows the roster, reconciles.) The seams keep the
 * two in step after every add/remove.
 */
function seededSlots(): SessionSlot[] {
  const seats = new Map<string, number>();
  for (const b of mockBookings) if (b.status === 'booked') seats.set(b.slotId, (seats.get(b.slotId) ?? 0) + 1);
  return mockSlots.map((s) => ({ ...s, bookedCount: seats.get(s.id) ?? 0 }));
}

let coaches: Coach[] = [...mockCoaches];
let players: Player[] = [...mockPlayers];
let slots: SessionSlot[] = seededSlots();
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

/**
 * Commit an academy session cancellation atomically: the slot flips to cancelled,
 * every affected booking flips to cancelled, and the refunded batches are replaced
 * in place. Callers (the cancelSession seam) compute the next-state objects; this
 * stays a dumb, atomic write — the rules live in the seam. S10 replaces the seam
 * body with one DB RPC; this commit disappears with the in-memory store.
 */
export function commitSessionCancellation(
  cancelledSlot: SessionSlot,
  cancelledBookings: Booking[],
  updatedBatches: CreditBatch[],
): void {
  const bookingById = new Map(cancelledBookings.map((b) => [b.id, b]));
  const batchById = new Map(updatedBatches.map((b) => [b.id, b]));
  slots = slots.map((s) => (s.id === cancelledSlot.id ? cancelledSlot : s));
  bookings = bookings.map((b) => bookingById.get(b.id) ?? b);
  batches = batches.map((b) => batchById.get(b.id) ?? b);
  emit();
}

/** Commit an edited slot (coach / capacity) in place. */
export function commitSlotUpdate(updatedSlot: SessionSlot): void {
  slots = slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s));
  emit();
}

/**
 * Append freshly-created slots — the bulk output of "generate slots", or a single
 * one-off. Purely additive: it never rewrites an existing slot, which is what keeps
 * generation from ever touching a session that's already on the calendar. S10
 * replaces this with a bulk INSERT (a `generate_slots` RPC on the DB side).
 */
export function commitNewSlots(newSlots: SessionSlot[]): void {
  if (newSlots.length === 0) return;
  slots = [...slots, ...newSlots];
  emit();
}

/**
 * Insert-or-replace an availability template by id (create appends, edit replaces
 * in place). Editing keeps the id, so slots already generated from the rule keep
 * their templateId link. S10 → INSERT/UPDATE.
 */
export function commitTemplateSave(template: AvailabilityTemplate): void {
  templates = templates.some((t) => t.id === template.id)
    ? templates.map((t) => (t.id === template.id ? template : t))
    : [...templates, template];
  emit();
}

/**
 * Delete an availability template. Deliberately does NOT touch the slots it
 * generated — deleting a recurring rule stops FUTURE generation but leaves every
 * already-scheduled (and possibly booked) session in place. S10 → DELETE.
 */
export function commitTemplateDelete(templateId: AvailabilityTemplate['id']): void {
  templates = templates.filter((t) => t.id !== templateId);
  emit();
}

/**
 * Commit an admin-initiated booking atomically: prepend the new booking, replace
 * the spent batch (decremented), and replace the slot (one more seat taken). The
 * seam computes the next-state; this is a dumb write. S10 replaces the seam body
 * with a DB RPC and this disappears with the in-memory store.
 */
export function commitAdminBooking(
  booking: Booking,
  updatedBatch: CreditBatch,
  updatedSlot: SessionSlot,
): void {
  bookings = [booking, ...bookings];
  batches = batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b));
  slots = slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s));
  emit();
}

/**
 * Commit a single-booking removal: the booking → cancelled, the slot's seat freed,
 * and — only on the refund path — the batch replaced (credit returned). `updatedBatch`
 * is omitted on a forfeit.
 */
export function commitBookingRemoval(
  cancelledBooking: Booking,
  updatedSlot: SessionSlot,
  updatedBatch?: CreditBatch,
): void {
  bookings = bookings.map((b) => (b.id === cancelledBooking.id ? cancelledBooking : b));
  slots = slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s));
  if (updatedBatch) batches = batches.map((b) => (b.id === updatedBatch.id ? updatedBatch : b));
  emit();
}

/**
 * Commit an attendance mark: a plain status flip on ONE booking (booked ⇄ attended
 * ⇄ no_show). No batch or seat changes — the credit was spent at booking time and
 * stays spent whatever happened on court. S10 → a small is_admin-gated UPDATE.
 */
export function commitBookingStatus(updatedBooking: Booking): void {
  bookings = bookings.map((b) => (b.id === updatedBooking.id ? updatedBooking : b));
  emit();
}

/**
 * Mint a credit batch (the admin_grant comp). Purely additive. Unlike coach/package
 * config writes, credit_batches has NO admin write policy in the schema — minting
 * credits is money and must be atomic + audited — so S10 replaces the grant seam
 * with a SECURITY DEFINER RPC, not a plain insert. This commit is the mock stand-in.
 */
export function commitCreditGrant(batch: CreditBatch): void {
  batches = [batch, ...batches];
  emit();
}

/** Insert-or-replace a player by id (edit replaces in place). S10 → is_admin UPDATE. */
export function commitPlayerSave(player: Player): void {
  players = players.some((p) => p.id === player.id)
    ? players.map((p) => (p.id === player.id ? player : p))
    : [...players, player];
  emit();
}

/**
 * Insert-or-replace a coach by id (create appends, edit replaces in place).
 * Coaches are never deleted — they hold historical slots and bookings, and the FK
 * would reject it — so "remove" is always isActive:false. S10 → is_admin-gated
 * INSERT/UPDATE (config, not money: no RPC).
 */
export function commitCoachSave(coach: Coach): void {
  coaches = coaches.some((c) => c.id === coach.id)
    ? coaches.map((c) => (c.id === coach.id ? coach : c))
    : [...coaches, coach];
  emit();
}

/**
 * Insert-or-replace a package by id. Packages are never deleted either — sold
 * credits reference them and stay valid — so "retire" is isActive:false (Hidden).
 * Editing price/name/sellable is captured-immune downstream (see creditLiability).
 * S10 → is_admin-gated INSERT/UPDATE.
 */
export function commitPackageSave(pkg: Package): void {
  packages = packages.some((p) => p.id === pkg.id)
    ? packages.map((p) => (p.id === pkg.id ? pkg : p))
    : [...packages, pkg];
  emit();
}

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
  slots = seededSlots();
  templates = [...mockTemplates];
  bookings = [...mockBookings];
  packages = [...mockPackages];
  purchases = [...mockPurchases];
  batches = [...mockCreditBatches];
  version = 0;
}
