import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore`, not `useState` + an effect: matchMedia IS an external store,
 * and reading it through the store API means the first render already has the right
 * answer (no post-mount flash of the wrong layout) and no setState-in-an-effect.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * The ONE mobile breakpoint, in JS.
 *
 * ⚠️ 768px must stay in step with the CSS breakpoint documented at the top of
 * Shell.module.css. A page that switches its markup here while its stylesheet
 * switches somewhere else is the classic way this pattern rots.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
