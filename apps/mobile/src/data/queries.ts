import type { BookingId, CoachId, IsoInstant, News, NewsId, Notification, NotificationId, PlayerId, Purchase, SessionSlot, SlotId, TrainingType } from '@tpa/types';
import { SLOT_WINDOW_TRAILING_DAYS } from '@tpa/core';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  bookSlotRpc,
  cancelBookingRpc,
  fetchAppConfig,
  fetchBookings,
  fetchCoaches,
  fetchCoachRoster,
  fetchCoachSlots,
  fetchMyCoachHours,
  daysBefore,
  fetchCreditBatches,
  fetchMyCreditRequests,
  fetchNewsSeen,
  fetchNotificationsPage,
  fetchPastSessionsPage,
  fetchPurchaseCount,
  fetchUnreadNotificationCount,
  fetchVisibleNews,
  trialEligibleRpc,
  fetchPackages,
  fetchPurchases,
  fetchSlots,
  fetchTemplates,
  markAllNotificationsRead,
  markNewsSeen,
  markNotificationRead,
  type BookReason,
  type PastSessionRow,
  type RosterEntry,
  type CancelReason,
} from '../lib/api';
import { BOOKING_TOUCHED_KEYS, queryClient, queryKeys } from '../lib/queryClient';

/**
 * The React Query layer: every screen's data is a hook here. Reads are cached and
 * refetched; the two money mutations invalidate the wallet / bookings / slots keys
 * so a spend or a refund shows up with NO manual refresh — the guarantee this whole
 * choice was made for. Pure @tpa/core derivations stay in the sibling data/* files;
 * these hooks just supply them live rows.
 */

/** A normalized query result — what screens gate their loading / error UI on. */
export interface Resource<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function toResource<T>(
  q: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown },
  dataOverride?: T,
): Resource<T> {
  return {
    data: dataOverride ?? q.data,
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}

/**
 * A cursor-paged read: the rows loaded so far, plus the one action that loads the
 * next (older) page. Both bounded history reads in this app — the notification feed
 * and pre-window past sessions — are this shape, so the screens that render them
 * share one contract instead of each inventing a load-more.
 */
export interface PagedResource<T> {
  items: T[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Another page exists (or nothing has been loaded yet and one might). */
  hasMore: boolean;
  /** A page beyond the first is in flight — for the button's spinner. */
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

function toPaged<T>(q: {
  data: { pages: { rows: T[] }[] } | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
}): PagedResource<T> {
  return {
    items: (q.data?.pages ?? []).flatMap((page) => page.rows),
    isPending: q.isPending,
    isError: q.isError,
    error: q.error,
    hasMore: q.hasNextPage,
    isLoadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
    refetch: () => void q.refetch(),
  };
}

// ── raw resource hooks ────────────────────────────────────────────────────────

export const useCoaches = () =>
  toResource(useQuery({ queryKey: queryKeys.coaches, queryFn: fetchCoaches }));

export const usePackages = () =>
  toResource(useQuery({ queryKey: queryKeys.packages, queryFn: fetchPackages }));

/**
 * Published slots from the trailing window onwards (see `fetchSlots`) — bounded
 * below, every future slot above. `now` is closed over by the queryFn and kept OUT
 * of the key, exactly like `useNews(now)`: the key stays stable so a ticking clock
 * never causes a refetch, and each real fetch computes a fresh cutoff.
 */
export const useSlots = (now: IsoInstant) =>
  toResource(useQuery({ queryKey: queryKeys.slots, queryFn: () => fetchSlots(now) }));

export const useTemplates = () =>
  toResource(useQuery({ queryKey: queryKeys.templates, queryFn: fetchTemplates }));

export const useBookings = () =>
  toResource(useQuery({ queryKey: queryKeys.bookings, queryFn: fetchBookings }));

/** The player's credit batches — minted server-side by the Paymob webhook (S6). */
export const useBatches = () =>
  toResource(useQuery({ queryKey: queryKeys.creditBatches, queryFn: fetchCreditBatches }));

/**
 * The player's purchases (pending until the webhook settles them), newest first,
 * bounded to `since`. Pass `null` for the lifetime list — only delete-account needs
 * it, because it values every unused credit against the purchase that paid for it.
 */
export const usePurchases = (since: IsoInstant | null): Resource<Purchase[]> =>
  toResource(
    useQuery({ queryKey: [...queryKeys.purchases, { since }], queryFn: () => fetchPurchases(since) }),
  );

/** Lifetime purchase count — a head:true count, so the Profile subtitle stays exact
 *  while the list behind it is windowed. */
export const usePurchaseCount = (): Resource<number> =>
  toResource(useQuery({ queryKey: queryKeys.purchaseCount, queryFn: fetchPurchaseCount }));

/**
 * The notification centre's feed — one page at a time, newest first, kept live by
 * Realtime (NotificationsBridge invalidates the ['notifications'] PREFIX, which
 * covers both this feed and the unread count below).
 */
export const useNotificationsFeed = (): PagedResource<Notification> =>
  toPaged(
    useInfiniteQuery({
      queryKey: queryKeys.notificationsFeed,
      queryFn: ({ pageParam }) => fetchNotificationsPage({ before: pageParam }),
      initialPageParam: undefined as IsoInstant | undefined,
      getNextPageParam: (last) => (last.hasMore ? last.rows[last.rows.length - 1]?.createdAt : undefined),
    }),
  );

/** Unread count for the bell badge — a head:true count, exact regardless of how many
 *  pages of the feed have been loaded. */
export const useUnreadNotificationCount = (): Resource<number> =>
  toResource(
    useQuery({ queryKey: queryKeys.notificationsUnread, queryFn: fetchUnreadNotificationCount }),
  );

/**
 * The player's sessions OLDER than the slot window — fetched only when they ask.
 * The first page starts at the window's trailing edge, so it continues exactly where
 * the pre-loaded slots stop: no gap, no duplicates.
 */
export function usePastSessionsOlder(now: IsoInstant): PagedResource<PastSessionRow> {
  // Nothing is fetched until the player actually asks. The latch lives here rather
  // than in the screen so "load older" is one call at the call site, whether it is
  // the first page or the fifth.
  const [started, setStarted] = useState(false);
  const q = useInfiniteQuery({
    queryKey: queryKeys.pastSessions,
    queryFn: ({ pageParam }) => fetchPastSessionsPage({ before: pageParam }),
    initialPageParam: daysBefore(now, SLOT_WINDOW_TRAILING_DAYS),
    getNextPageParam: (last) =>
      last.hasMore ? last.rows[last.rows.length - 1]?.slot.startsAt : undefined,
    enabled: started,
  });
  const paged = toPaged(q);
  return {
    ...paged,
    // Before the first tap there is no page to judge from, so assume older sessions
    // may exist; after it, the server's hasMore decides.
    hasMore: started ? paged.hasMore : true,
    isLoadingMore: started ? paged.isPending || paged.isLoadingMore : false,
    loadMore: () => (started ? paged.loadMore() : setStarted(true)),
  };
}

/** The player's credit requests, newest first (A4) — the pending/resolved status shown in the wallet. */
export const useMyCreditRequests = () =>
  toResource(useQuery({ queryKey: queryKeys.creditRequests, queryFn: fetchMyCreditRequests }));

/** Whether the player can still buy the once-per-player trial (A5) — hides trial in the store. */
export const useTrialEligible = () =>
  toResource(useQuery({ queryKey: queryKeys.trialEligible, queryFn: trialEligibleRpc }));

/** Visible news (within the window), newest first. */
export const useNews = (now: IsoInstant) =>
  toResource(useQuery({ queryKey: queryKeys.news, queryFn: () => fetchVisibleNews(now) }));

/**
 * app_config — read once per app session for the update prompt. A long staleTime
 * because it changes only when the academy ships a release; the default retry
 * still applies, and a failure leaves `data` undefined, which the prompt reads as
 * "don't show".
 */
export const useAppConfig = () =>
  toResource(
    useQuery({ queryKey: queryKeys.appConfig, queryFn: fetchAppConfig, staleTime: 60 * 60_000 }),
  );

/** This player's own news_seen rows. */
export const useNewsSeen = () =>
  toResource(useQuery({ queryKey: queryKeys.newsSeen, queryFn: fetchNewsSeen }));

/**
 * Visible news the player has NOT seen, newest first — the ONE derivation the nav
 * button's red dot, the unseen pop-up, and (if it ever needs it) the feed all read,
 * so they can never disagree about what counts as unseen. `undefined` while either
 * underlying query hasn't loaded (offline cold start included) — callers treat that
 * as "nothing to show yet," never as "zero unseen."
 */
export function useUnseenNews(now: IsoInstant): Resource<News[]> {
  const newsQ = useNews(now);
  const seenQ = useNewsSeen();
  const isPending = newsQ.isPending || seenQ.isPending;
  const isError = newsQ.isError || seenQ.isError;
  const seenIds = new Set((seenQ.data ?? []).map((s) => s.newsId));
  const unseen = (newsQ.data ?? []).filter((n) => !seenIds.has(n.id));
  return {
    data: isPending || isError ? undefined : unseen,
    isPending,
    isError,
    error: newsQ.error ?? seenQ.error,
    refetch: () => {
      newsQ.refetch();
      seenQ.refetch();
    },
  };
}

/** Mark news items seen (pop-up dismiss, or the feed marking everything visible on open). */
export function useMarkNewsSeen() {
  return useMutation({
    mutationFn: ({ playerId, newsIds }: { playerId: PlayerId; newsIds: NewsId[] }) =>
      markNewsSeen(playerId, newsIds),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.newsSeen }),
  });
}

/** Mark one notification read (on tap / deep-link). read_at is the only writable column. */
export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: ({ id, now }: { id: NotificationId; now: IsoInstant }) => markNotificationRead(id, now),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

/** Mark every unread notification read (the centre's "mark all" on open). */
export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: (now: IsoInstant) => markAllNotificationsRead(now),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

// ── coach mode ────────────────────────────────────────────────────────

/**
 * The signed-in coach's own sessions. `enabled` on the id, so the hook is inert for
 * a player who has no coach link — nothing is fetched and nothing 400s.
 */
export const useCoachSlots = (coachId: CoachId | null, now: IsoInstant): Resource<SessionSlot[]> =>
  toResource(
    useQuery({
      queryKey: [...queryKeys.coachSlots, coachId],
      queryFn: () => fetchCoachSlots(coachId as CoachId, now),
      enabled: coachId != null,
    }),
  );

/**
 * Hours coached for one Cairo month. `monthOffset` 0 is this month, -1 last month —
 * the offset is applied in calendar space (setMonth), so it never drifts on a 31st.
 * Keyed by the offset, so the two months the Hours tab shows are separate entries
 * rather than one racing the other.
 */
export const useMyCoachHours = (enabled: boolean, monthOffset = 0): Resource<number> =>
  toResource(
    useQuery({
      queryKey: [...queryKeys.coachHours, monthOffset],
      queryFn: () => {
        if (monthOffset === 0) return fetchMyCoachHours();
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + monthOffset);
        return fetchMyCoachHours(d);
      },
      enabled,
    }),
  );

/** The roster for one of the coach's own sessions — name and level only. */
export const useCoachRoster = (slotId: SlotId | null): Resource<RosterEntry[]> =>
  toResource(
    useQuery({
      queryKey: [...queryKeys.coachRoster, slotId],
      queryFn: () => fetchCoachRoster(slotId as SlotId),
      enabled: slotId != null,
    }),
  );

/** Collapse several resources into one loading / error / retry gate for a screen. */
export function combine(...rs: Resource<unknown>[]): {
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
} {
  return {
    isPending: rs.some((r) => r.isPending),
    isError: rs.some((r) => r.isError),
    refetch: () => rs.forEach((r) => r.refetch()),
  };
}

// ── money mutations: invalidate + reconcile ───────────────────────────────────

async function refetchBookingTouched(): Promise<void> {
  await Promise.all(
    BOOKING_TOUCHED_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: key })),
  );
}

/**
 * Outcomes are DATA, never thrown. `rejected` is a business no (slot_full, …) from
 * the RPC. `unconfirmed` is the dangerous one: the request failed at the transport
 * level AFTER the server may have committed — a lost response. We never guess; we
 * re-read the server to see what actually happened, and only report `unconfirmed`
 * when even that couldn't confirm it, so the screen can offer a safe retry instead
 * of a lie.
 */
export type BookOutcome =
  | { status: 'booked'; reconciled: boolean; bookingId: BookingId }
  | { status: 'rejected'; reason: BookReason }
  | { status: 'unconfirmed' };

/** The id of a non-cancelled booking for this slot, if one landed. Reads fresh. */
async function bookedBookingId(slotId: SlotId): Promise<BookingId | null> {
  const bookings = await fetchBookings();
  return bookings.find((b) => b.slotId === slotId && b.status !== 'cancelled')?.id ?? null;
}

export interface BookSlotInput {
  slotId: SlotId;
  /** The player's picked type on an OPEN block; null for an already-typed slot. */
  trainingType: TrainingType | null;
}

export function useBookSlot() {
  return useMutation<BookOutcome, never, BookSlotInput>({
    mutationFn: async ({ slotId, trainingType }) => {
      try {
        const res = await bookSlotRpc(slotId, trainingType);
        await refetchBookingTouched();
        return res.ok
          ? { status: 'booked', reconciled: false, bookingId: res.bookingId }
          : { status: 'rejected', reason: res.reason };
      } catch {
        // Transport failure — the spend may have committed. Reconcile against truth.
        const landed = await bookedBookingId(slotId).catch(() => null);
        await refetchBookingTouched();
        return landed ? { status: 'booked', reconciled: true, bookingId: landed } : { status: 'unconfirmed' };
      }
    },
  });
}

export type CancelOutcome =
  | { status: 'cancelled'; refunded: boolean; reconciled: boolean }
  | { status: 'rejected'; reason: CancelReason }
  | { status: 'unconfirmed' };

/** Is this booking now cancelled on the server? Reads fresh. */
async function bookingIsCancelled(bookingId: BookingId): Promise<boolean> {
  const bookings = await fetchBookings();
  return bookings.some((b) => b.id === bookingId && b.status === 'cancelled');
}

export function useCancelBooking() {
  return useMutation<CancelOutcome, never, { bookingId: BookingId; expectedRefund: boolean }>({
    mutationFn: async ({ bookingId, expectedRefund }) => {
      try {
        const res = await cancelBookingRpc(bookingId);
        await refetchBookingTouched();
        return res.ok
          ? { status: 'cancelled', refunded: res.refunded, reconciled: false }
          : { status: 'rejected', reason: res.reason };
      } catch {
        const cancelled = await bookingIsCancelled(bookingId).catch(() => false);
        await refetchBookingTouched();
        // If it landed, we couldn't read back the refund flag — fall back to what the
        // preview promised (isCancellableWithoutForfeit), which the RPC uses too.
        return cancelled
          ? { status: 'cancelled', refunded: expectedRefund, reconciled: true }
          : { status: 'unconfirmed' };
      }
    },
  });
}
