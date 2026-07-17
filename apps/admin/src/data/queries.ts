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
import { useQuery } from '@tanstack/react-query';

import {
  ApiError,
  fetchBookings,
  fetchCoaches,
  fetchCreditBatches,
  fetchPackages,
  fetchPlayers,
  fetchPurchases,
  fetchSlots,
  fetchTemplates,
} from '../lib/api';
import { queryClient, queryKeys } from '../lib/queryClient';

/**
 * The admin's React Query layer. Resource hooks feed the pure aggregates (data/*)
 * live Supabase rows; the two mutation helpers give every seam the contract S9.2
 * fixed on the client — a seam returns a result, it never throws. A business
 * rejection ({ok:false,reason}) from an RPC passes straight through; a transport
 * failure becomes reason 'network'; a config write's constraint violation (23P01,
 * coach double-booking) becomes 'coach_conflict'. Success invalidates the keys the
 * mutation touched, so the affected reads refetch with no manual cache work.
 */

export interface Resource<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

function toResource<T>(q: {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}): Resource<T> {
  return { data: q.data, isPending: q.isPending, isError: q.isError, refetch: () => void q.refetch() };
}

export const useCoaches = () => toResource(useQuery({ queryKey: queryKeys.coaches, queryFn: fetchCoaches }));
export const usePlayers = () => toResource(useQuery({ queryKey: queryKeys.players, queryFn: fetchPlayers }));
export const usePackages = () => toResource(useQuery({ queryKey: queryKeys.packages, queryFn: fetchPackages }));
export const useTemplates = () => toResource(useQuery({ queryKey: queryKeys.templates, queryFn: fetchTemplates }));
export const useSlots = () => toResource(useQuery({ queryKey: queryKeys.slots, queryFn: fetchSlots }));
export const useBatches = () => toResource(useQuery({ queryKey: queryKeys.batches, queryFn: fetchCreditBatches }));
export const useBookings = () => toResource(useQuery({ queryKey: queryKeys.bookings, queryFn: fetchBookings }));
export const usePurchases = () => toResource(useQuery({ queryKey: queryKeys.purchases, queryFn: fetchPurchases }));

/** Collapse several resources into one loading / error / retry gate for a page. */
export function combine(...rs: Resource<unknown>[]): { isPending: boolean; isError: boolean; refetch: () => void } {
  return {
    isPending: rs.some((r) => r.isPending),
    isError: rs.some((r) => r.isError),
    refetch: () => rs.forEach((r) => r.refetch()),
  };
}

/**
 * The whole admin dataset in one call — most pages read across several entities, so
 * this keeps them to a single gate. Empty arrays until loaded, so aggregates can run
 * against `?? []` without guarding every field.
 */
export interface AdminData {
  coaches: Coach[];
  players: Player[];
  packages: Package[];
  templates: AvailabilityTemplate[];
  slots: SessionSlot[];
  batches: CreditBatch[];
  bookings: Booking[];
  purchases: Purchase[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useAdminData(): AdminData {
  const coaches = useCoaches();
  const players = usePlayers();
  const packages = usePackages();
  const templates = useTemplates();
  const slots = useSlots();
  const batches = useBatches();
  const bookings = useBookings();
  const purchases = usePurchases();
  const gate = combine(coaches, players, packages, templates, slots, batches, bookings, purchases);
  return {
    coaches: coaches.data ?? [],
    players: players.data ?? [],
    packages: packages.data ?? [],
    templates: templates.data ?? [],
    slots: slots.data ?? [],
    batches: batches.data ?? [],
    bookings: bookings.data ?? [],
    purchases: purchases.data ?? [],
    ...gate,
  };
}

// ── mutation helpers: a result, never a throw ──────────────────────────────────
async function invalidate(keys: readonly (readonly unknown[])[]): Promise<void> {
  await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: key as unknown[] })));
}

/** Run an {ok,reason} RPC. Success invalidates `touched`; transport failure → 'network'. */
export async function runRpc<T extends { ok: boolean }>(
  call: () => Promise<T>,
  touched: readonly (readonly unknown[])[],
): Promise<T | { ok: false; reason: 'network' }> {
  try {
    const res = await call();
    if (res.ok) await invalidate(touched);
    return res;
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'coach_conflict' | 'network' };

/** Run a direct config write. Maps 23P01 (coach double-booking) to a real reason. */
export async function runWrite<T>(
  call: () => Promise<T>,
  touched: readonly (readonly unknown[])[],
): Promise<WriteResult<T>> {
  try {
    const value = await call();
    await invalidate(touched);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof ApiError && e.code === '23P01') return { ok: false, reason: 'coach_conflict' };
    return { ok: false, reason: 'network' };
  }
}
