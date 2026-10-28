import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

/**
 * The React Query behaviour LocationProvider's fix depends on, pinned so an upgrade
 * that changes it fails here rather than as a missing branch toggle on a phone.
 *
 * LocationProvider mounts above the navigator and holds one observer on the
 * `locations` query for the life of the app. SessionProvider calls
 * queryClient.clear() whenever the session is null — including at launch when
 * signed out. That removes the query the observer is attached to; after sign-in,
 * screens fetch the branches into a NEW query in the cache.
 */
describe('a long-lived observer across queryClient.clear()', () => {
  const key = ['locations'] as const;

  it('stays on the removed query — and sees nothing — until its options are set again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => ['oro', 'second']);

    // The provider at launch, signed out: disabled, so no anon request is made.
    const provider = new QueryObserver(client, { queryKey: key, queryFn, enabled: false });
    const unsubscribe = provider.subscribe(() => {});

    client.clear(); // INITIAL_SESSION with a null session

    // After sign-in, a screen fetches the branches into the cache.
    await client.fetchQuery({ queryKey: key, queryFn });
    expect(client.getQueryData(key)).toEqual(['oro', 'second']);

    // The bug: the provider's observer never saw them.
    expect(provider.getCurrentResult().data).toBeUndefined();

    // The fix: reading the session re-renders the provider on sign-in, and a
    // re-render is useQuery calling setOptions — which re-binds to the live query.
    provider.setOptions({ queryKey: key, queryFn, enabled: true });
    expect(provider.getCurrentResult().data).toEqual(['oro', 'second']);

    unsubscribe();
    client.clear();
  });
});
