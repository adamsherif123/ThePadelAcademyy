import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CoachId,
  CreditBatch,
  IsoInstant,
  Location,
  LocationId,
  News,
  Package,
  Player,
  Purchase,
  SessionSlot,
} from '@tpa/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type {
  BookingsPageParams,
  BookingsPageResult,
  CreditRequestsPageParams,
  CreditRequestsPageResult,
  CreditRequestStatusCounts,
  PlayersPageParams,
  PlayersPageResult,
} from '../lib/api';
import {
  ApiError,
  fetchBookings,
  fetchBookingsPage,
  fetchCreditRequestsPage,
  fetchCreditRequestStatusCounts,
  fetchPlayersPage,
  fetchBookingStatusCounts,
  fetchCoachHours,
  fetchCoaches,
  fetchLocations,
  fetchCreditBatches,
  fetchCreditRequests,
  fetchNews,
  fetchPackages,
  fetchPlayers,
  fetchPurchases,
  fetchPurchasesInRange,
  fetchEarliestPurchaseInstant,
  fetchSlots,
  fetchTemplates,
} from '../lib/api';
import { queryClient, queryKeys } from '../lib/queryClient';
import type { BookingStatusCounts } from './bookingList';

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

/**
 * A Resource that also reports a background refetch.
 *
 * `keepPreviousData` is what stops a month change flashing a spinner — but it also
 * means that for the moment between picking October and October arriving, the
 * screen is showing September's numbers. Under a label that now says October. For
 * a money figure that is not a cosmetic problem, so the pages that use it dim the
 * figures while this is true rather than presenting the old month as the new one.
 */
export interface Refetchable<T> extends Resource<T> {
  isFetching: boolean;
}

function toRefetchable<T>(q: {
  data: T | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => unknown;
}): Refetchable<T> {
  return {
    data: q.data,
    isPending: q.isPending,
    isFetching: q.isFetching,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
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
export const useLocations = () => toResource(useQuery({ queryKey: queryKeys.locations, queryFn: fetchLocations }));
/**
 * Hours coached per coach for one Cairo month — a separate lightweight query (the
 * SQL aggregate), never folded into useAdminData's monolith. Coaches.tsx defaults
 * a coach absent from the map to 0.
 *
 * `monthKey` null means the current month and sends no argument, which is the RPC's
 * own default — so the page's default load is the same single request it always was.
 * A past month is a different cache entry, fetched the first time it is asked for
 * and then free to return to. The rows behind it never change (the month is over),
 * which is what makes caching a past month safe in a way caching the current one
 * would not be.
 */
export const useCoachHours = (monthKey: string | null = null): Refetchable<Record<CoachId, number>> =>
  toRefetchable(
    useQuery({
      queryKey: [...queryKeys.coachHours, monthKey],
      queryFn: () => fetchCoachHours(monthKey),
      placeholderData: keepPreviousData,
    }),
  );
export const usePlayers = () => toResource(useQuery({ queryKey: queryKeys.players, queryFn: fetchPlayers }));
export const usePackages = () => toResource(useQuery({ queryKey: queryKeys.packages, queryFn: fetchPackages }));
export const useTemplates = () => toResource(useQuery({ queryKey: queryKeys.templates, queryFn: fetchTemplates }));
export const useSlots = () => toResource(useQuery({ queryKey: queryKeys.slots, queryFn: fetchSlots }));
export const useBatches = () => toResource(useQuery({ queryKey: queryKeys.batches, queryFn: fetchCreditBatches }));
export const useBookings = () => toResource(useQuery({ queryKey: queryKeys.bookings, queryFn: fetchBookings }));
export const usePurchases = () => toResource(useQuery({ queryKey: queryKeys.purchases, queryFn: fetchPurchases }));

/**
 * Purchases inside one [start, end) window — the Dashboard's read.
 *
 * The point of the window is that the months before it are never fetched unless
 * somebody picks one. Each window is its own cache entry, so going back to a month
 * you have already opened is instant and costs nothing; `keepPreviousData` keeps
 * the month you were looking at on screen while the next one loads, so the KPIs
 * change value rather than collapsing to a spinner and back.
 */
export const usePurchasesInRange = (start: IsoInstant, end: IsoInstant): Refetchable<Purchase[]> =>
  toRefetchable(
    useQuery({
      queryKey: [...queryKeys.purchasesInRange, start, end],
      queryFn: () => fetchPurchasesInRange(start, end),
      placeholderData: keepPreviousData,
    }),
  );

/**
 * When the academy's first purchase was — one row, and the only thing that decides
 * how far back the month picker offers. Null for an academy that has never sold
 * anything, which the picker renders as "this month only".
 */
export const useEarliestPurchase = (): Resource<IsoInstant | null> =>
  toResource(useQuery({ queryKey: queryKeys.earliestPurchase, queryFn: fetchEarliestPurchaseInstant }));
export const useCreditRequests = () =>
  toResource(useQuery({ queryKey: queryKeys.creditRequests, queryFn: fetchCreditRequests }));
export const useNews = (): Resource<News[]> =>
  toResource(useQuery({ queryKey: queryKeys.news, queryFn: fetchNews }));

/**
 * The Bookings page's own bounded, filtered, paginated read — independent of
 * useAdminData's monolith. `placeholderData: keepPreviousData` keeps the
 * previous page's rows on screen (instead of a blank flash) while the next
 * page/filter is in flight; `isFetching` distinguishes that from the initial load.
 */
export function useBookingsPage(params: BookingsPageParams): {
  data: BookingsPageResult | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: [...queryKeys.bookingsPage, params],
    queryFn: () => fetchBookingsPage(params),
    placeholderData: keepPreviousData,
  });
  return { data: q.data, isPending: q.isPending, isFetching: q.isFetching, isError: q.isError, refetch: () => void q.refetch() };
}

/**
 * The Players page's own bounded, filtered, paginated read — independent of
 * useAdminData's monolith, exactly like useBookingsPage. `keepPreviousData` holds the
 * previous page's rows on screen while the next page is in flight, so paging doesn't
 * flash an empty list; `isFetching` distinguishes that from the initial load.
 */
export function usePlayersPage(params: PlayersPageParams): {
  data: PlayersPageResult | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: [...queryKeys.playersPage, params],
    queryFn: () => fetchPlayersPage(params),
    placeholderData: keepPreviousData,
  });
  return { data: q.data, isPending: q.isPending, isFetching: q.isFetching, isError: q.isError, refetch: () => void q.refetch() };
}

/**
 * The Credit Requests page's own bounded, filtered, paginated read — independent of the
 * whole-table useCreditRequests that Packages' delete-guard still uses.
 */
export function useCreditRequestsPage(params: CreditRequestsPageParams): {
  data: CreditRequestsPageResult | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const q = useQuery({
    queryKey: [...queryKeys.creditRequestsPage, params],
    queryFn: () => fetchCreditRequestsPage(params),
    placeholderData: keepPreviousData,
  });
  return { data: q.data, isPending: q.isPending, isFetching: q.isFetching, isError: q.isError, refetch: () => void q.refetch() };
}

/**
 * Whole-table credit-request counts — independent of the PAGE, but scoped to the
 * branch filter (S6): the cards describe the population the list is showing, so
 * "3 awaiting review" must mean three at this branch, not three somewhere.
 * The branch joins the query key, so each branch caches its own counts.
 */
export const useCreditRequestStatusCounts = (locationId: LocationId | 'all'): Resource<CreditRequestStatusCounts> =>
  toResource(
    useQuery({
      queryKey: [...queryKeys.creditRequestStatusCounts, locationId],
      queryFn: () => fetchCreditRequestStatusCounts(locationId),
    }),
  );

/** The 4 status-count cards — all-time across the selected branch, not just the current page. */
export const useBookingStatusCounts = (locationId: LocationId | 'all'): Resource<BookingStatusCounts> =>
  toResource(
    useQuery({
      queryKey: [...queryKeys.bookingStatusCounts, locationId],
      queryFn: () => fetchBookingStatusCounts(locationId),
    }),
  );


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
  locations: Location[];
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
  const locations = useLocations();
  const players = usePlayers();
  const packages = usePackages();
  const templates = useTemplates();
  const slots = useSlots();
  const batches = useBatches();
  const bookings = useBookings();
  const purchases = usePurchases();
  const gate = combine(coaches, locations, players, packages, templates, slots, batches, bookings, purchases);
  return {
    coaches: coaches.data ?? [],
    locations: locations.data ?? [],
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
