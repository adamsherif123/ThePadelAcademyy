import { toInstant } from '@tpa/core';
import type { NotificationId } from '@tpa/types';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { markNotificationRead, registerMyPushToken } from '../lib/api';
import { BOOKING_TOUCHED_KEYS, queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { useSession } from '../session/SessionProvider';
import { notificationHref } from './deepLink';
import { registerForPush } from './push';
import { setLastPushToken } from './tokenStore';

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
 * and (d) routes a tapped push to the right screen, including the cold-start case where
 * a tap launched the app from killed. Renders nothing. Fully degrades: no token, denied
 * permission, or a simulator all leave the rest working.
 */
export function NotificationsBridge(): null {
  const { player, status } = useSession();
  const router = useRouter();
  const playerId = player?.id ?? null;

  // Deep-link + mark-read, shared by warm taps and the cold-start tap.
  const openFromResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as {
        notificationId?: string;
        type?: string;
        slotId?: string | null;
      };
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
  //     token so sign-out / deletion can drop exactly this row.
  useEffect(() => {
    if (status !== 'ready' || !playerId) return;
    let cancelled = false;
    void (async () => {
      const res = await registerForPush();
      if (cancelled || res.status !== 'ok') return;
      setLastPushToken(res.token);
      await registerMyPushToken(res.token, res.platform).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, playerId]);

  // (b) Realtime: any change to this player's notifications refreshes the feed. This is
  //     what makes "confirmed" appear in-app instantly, push or no push.
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

  // (c) Foreground receipt → refresh; (d) tap → deep-link.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => refreshFromNotification());
    const responded = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => {
      received.remove();
      responded.remove();
    };
  }, [openFromResponse]);

  // Cold start: a tap that launched the app from killed. Handle once, only when a
  // player is ready (so the auth guard doesn't bounce the deep-link to sign-in).
  const coldStartDone = useRef(false);
  useEffect(() => {
    if (coldStartDone.current || status !== 'ready' || !playerId) return;
    coldStartDone.current = true;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openFromResponse(response);
    });
  }, [status, playerId, openFromResponse]);

  return null;
}
