import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useUnseenNews } from '../data/queries';
import { useSession } from '../session/SessionProvider';

/**
 * Decides WHEN the unseen-news pop-up should appear — cold start and foreground,
 * per the confirmed design. Mounts unconditionally in the root layout (mirroring
 * NotificationsBridge) but no-ops until `status === 'ready'`, so it never fires on
 * the sign-in screen, mid-auth, or before the session is restored; `useUnseenNews`
 * itself returns `undefined` data while offline/not-yet-loaded, so a cold start
 * with no connectivity simply shows nothing — no error, no retry loop.
 *
 * `shownRef` is a per-app-session dedupe: once THIS item has triggered a push this
 * session, it won't push again for the same id (avoids re-pushing on every
 * background refetch while the same item is still technically unseen). A
 * genuinely NEW unseen item (a fresh news_published notification landing while
 * the app is open) still triggers its own pop-up, since it has its own id.
 */
export function NewsPopupBridge(): null {
  const { status, now } = useSession();
  const router = useRouter();
  const unseenQ = useUnseenNews(now);
  const shownRef = useRef<Set<string>>(new Set());

  const tryShow = useCallback(() => {
    if (status !== 'ready') return;
    const newest = unseenQ.data?.[0];
    if (!newest || shownRef.current.has(newest.id)) return;
    shownRef.current.add(newest.id);
    router.push('/news-popup');
  }, [status, unseenQ.data, router]);

  // Cold start — and whenever the unseen set resolves/changes (covers the
  // offline-then-reconnects case: no data yet -> no-op -> data arrives -> shows).
  useEffect(() => {
    tryShow();
  }, [tryShow]);

  // Foreground (app backgrounded then reopened).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tryShow();
    });
    return () => sub.remove();
  }, [tryShow]);

  return null;
}
