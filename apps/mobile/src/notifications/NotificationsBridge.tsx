import { toInstant } from '@tpa/core';
import type { NotificationId } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { markNotificationRead, registerMyPushToken } from '../lib/api';
import { BOOKING_TOUCHED_KEYS, queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { useSession } from '../session/SessionProvider';
import { notificationHref } from './deepLink';
import {
  addPushListeners,
  getInitialTap,
  registerForPush,
  setupForegroundHandler,
  type PushTapData,
} from './push';
import { setLastPushToken } from './tokenStore';

// NOTE: this file does NOT import expo-notifications. All remote-push access goes through
// push.ts, which loads the module lazily and only outside Expo Go — so nothing here (or in
// push.ts) touches the throwing module at import time. The bridge only deals in plain data.

/** A push/notification landing means server state changed — refresh the feed and the
 *  wallet/bookings/slots so the in-app UI matches without waiting for a manual pull. */
function refreshFromNotification(): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  for (const key of BOOKING_TOUCHED_KEYS) void queryClient.invalidateQueries({ queryKey: key });
}

/**
 * Mounts once inside the signed-in tree. It (a) registers this device's push token for
 * the ready player, (b) keeps the in-app feed live via Realtime — so the badge updates
 * instantly even when push permission was denied, (c) refreshes on a foreground push,
 * and (d) routes a tapped push to the right screen, including the cold-start case. Renders
 * nothing. Fully degrades: Expo Go (no remote module — no crash), no token, denied
 * permission, or a simulator all leave the in-app centre + Realtime working; only the OS
 * banner is absent.
 */
export function NotificationsBridge(): null {
  const { player, status } = useSession();
  const router = useRouter();
  const playerId = player?.id ?? null;

  // Deep-link + mark-read, shared by warm taps and the cold-start tap.
  const openFromTap = useCallback(
    (data: PushTapData) => {
      if (data.notificationId) {
        void markNotificationRead(data.notificationId as NotificationId, toInstant(new Date())).catch(
          () => undefined,
        );
      }
      refreshFromNotification();
      router.push(notificationHref({ type: data.type ?? '', slotId: data.slotId ?? null }));
    },
    [router],
  );

  // (a) Register this device's token when a signed-up player is ready. Remember the
  //     token so sign-out / deletion can drop exactly this row. registerForPush never
  //     throws and returns 'expo_go' in Expo Go, so this simply no-ops there.
  useEffect(() => {
    if (status !== 'ready' || !playerId) return;
    let cancelled = false;
    void (async () => {
      const res = await registerForPush();
      // On-device confirmation of the path taken (Expo Go → 'expo_go'; dev build → 'ok').
      if (__DEV__) console.log('[push] registration:', res.status, 'reason' in res ? res.reason : '');
      if (cancelled || res.status !== 'ok') return;
      setLastPushToken(res.token);
      await registerMyPushToken(res.token, res.platform).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, playerId]);

  // (b) Realtime: any change to this player's notifications refreshes the feed. This is
  //     what makes "confirmed" appear in-app instantly, push or no push. No expo-notifications.
  useEffect(() => {
    if (!playerId) return;
    const channel = supabase
      .channel(`notifications:${playerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `player_id=eq.${playerId}` },
        () => refreshFromNotification(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [playerId]);

  // (c) Foreground handler + receipt/tap listeners. Async setup via push.ts (which no-ops
  //     in Expo Go and never throws); the effect stores the resolved cleanup.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void setupForegroundHandler();
    void addPushListeners({ onForeground: refreshFromNotification, onTap: openFromTap }).then((c) => {
      if (cancelled) c();
      else cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [openFromTap]);

  // (d) Cold start: a tap that launched the app from killed. Handle once, only when a
  //     player is ready. getInitialTap returns null in Expo Go and never throws.
  const coldStartDone = useRef(false);
  useEffect(() => {
    if (coldStartDone.current || status !== 'ready' || !playerId) return;
    coldStartDone.current = true;
    void getInitialTap().then((data) => {
      if (data) openFromTap(data);
    });
  }, [status, playerId, openFromTap]);

  return null;
}
