// The React Query client + the keys every read is filed under.
//
// Why TanStack Query at all: the data is now remote and async, and a purchase or a
// booking must leave the wallet correct with no manual refresh. Query gives us that
// for free — a mutation invalidates the wallet/bookings/slots keys and they refetch.
// The alternative (hydrating the old sync store) would mean hand-rolling that
// caching and invalidation, and the failure we'd hit — a stale wallet after a spend
// — is the one bug that destroys trust. So: Query owns the cache, keys below are the
// invalidation surface.
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, onlineManager } from '@tanstack/react-query';

// Teach Query the device's real connectivity so it pauses offline and resumes (and
// refetches) when the network returns — the backbone of the offline failure mode.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected ?? false)),
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reads are safe to retry; back off so a flaky network gets a few chances
      // before we show an error rather than spinning forever.
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Money mutations are NOT auto-retried: a retry after a lost success could
      // double-book. Retry/reconcile is handled deliberately at the call site.
      retry: false,
    },
  },
});

export { BOOKING_TOUCHED_KEYS, SLOT_BEARING_KEYS, queryKeys } from './queryKeys';
