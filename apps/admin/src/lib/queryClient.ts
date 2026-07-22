import { QueryClient } from '@tanstack/react-query';

/**
 * React Query for the admin — the same choice the client made (S9), for the same
 * reason: two data-fetching models across one product means maintaining both badly.
 * In the browser onlineManager works off navigator.onLine out of the box, so unlike
 * the RN client there's no NetInfo wiring. A mutation invalidates the keys it
 * touched and the affected reads refetch — no manual cache bookkeeping.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    // Money/occupancy mutations are RPCs that must not be blindly retried; each call
    // site decides. Config writes are safe but we keep the default off for symmetry.
    mutations: { retry: false },
  },
});

/** The single registry of query keys — the invalidation surface. */
export const queryKeys = {
  player: ['player'] as const, // the signed-in admin's own player row
  coaches: ['coaches'] as const,
  players: ['players'] as const,
  packages: ['packages'] as const,
  templates: ['templates'] as const,
  slots: ['slots'] as const,
  batches: ['batches'] as const,
  bookings: ['bookings'] as const,
  purchases: ['purchases'] as const,
  creditRequests: ['creditRequests'] as const,
};

/** What each mutation family touches — the keys it must invalidate. */
export const TOUCHED = {
  // cancel_session / remove_booking / admin_book_player affect bookings + seat counts + (refund) batches
  booking: [queryKeys.bookings, queryKeys.slots, queryKeys.batches] as const,
  // grant_credits / record_cash_purchase mint credits (+ a purchase row)
  money: [queryKeys.batches, queryKeys.purchases] as const,
  // approve mints a batch + a purchase AND resolves the request; reject resolves it (the
  // extra money keys are harmless no-ops on reject).
  creditRequests: [queryKeys.batches, queryKeys.purchases, queryKeys.creditRequests] as const,
  attendance: [queryKeys.bookings] as const,
  coaches: [queryKeys.coaches] as const,
  packages: [queryKeys.packages] as const,
  templates: [queryKeys.templates] as const,
  slots: [queryKeys.slots] as const,
  players: [queryKeys.players] as const,
};
