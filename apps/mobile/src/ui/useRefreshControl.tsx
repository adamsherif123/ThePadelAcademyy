import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import type { ReactElement } from 'react';

import { haptics } from '../lib/haptics';
import { queryClient } from '../lib/queryClient';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Pull-to-refresh for a screen, as a ready-made <RefreshControl/>.
 *
 * Why this exists: the client caches reads with a 30s staleTime and
 * `refetchOnWindowFocus: false`, and tab screens never unmount — so once a tab has
 * mounted, nothing refetches it. An admin publishing a new session was therefore
 * invisible until the app was killed and cold-started. This is the manual escape
 * hatch: pull down, refetch, done.
 *
 * `keys` are the screen's OWN query keys, not everything — a pull on Book must not
 * re-fetch purchases or notifications. Pass a module-level constant so the array
 * identity is stable across renders.
 *
 * `refreshing` is tied to the real refetch promise, not a timer: the spinner
 * dismisses when the fetches actually settle, whether they succeed or fail (a failed
 * refresh that spun forever would be worse than no refresh at all).
 */
export function useRefreshControl(
  keys: readonly (readonly unknown[])[],
): ReactElement<RefreshControlProps> {
  const { color } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // The pull can outlive the screen (pull, then navigate away mid-fetch).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    // Once per pull, at the moment the gesture commits — the tick confirms the pull
    // registered, before any data arrives. Fire-and-forget through the wrapper (which
    // already honours Reduce Motion and the OS haptic setting); it never gates the
    // refetch below.
    haptics.light();
    setRefreshing(true);
    void Promise.all(keys.map((key) => queryClient.refetchQueries({ queryKey: key as unknown[] })))
      .catch(() => {
        // A failed refetch leaves the existing data on screen and the query's own
        // error state to the screen's ErrorView — the spinner just stops.
      })
      .finally(() => {
        if (mounted.current) setRefreshing(false);
      });
  }, [keys]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      // Theme tokens, not a brand colour: text.secondary is #60708f on the light
      // canvas and #9aa8c7 on the dark one, so the spinner reads in both schemes
      // (iOS uses tintColor, Android the colors array + the circle's background).
      tintColor={color.text.secondary}
      colors={[color.text.secondary]}
      progressBackgroundColor={color.bg.surface}
    />
  );
}
