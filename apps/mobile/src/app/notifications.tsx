import Ionicons from '@expo/vector-icons/Ionicons';
import { formatRelativeTime } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { Notification, NotificationType } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useNotifications, useMarkAllNotificationsRead } from '../data/queries';
import { notificationHref } from '../notifications/deepLink';
import { useSession } from '../session/SessionProvider';
import { Card, EmptyState, ErrorView, LoadingView, Screen, ScreenHeader, Text } from '../ui';
import type { IoniconName } from '../ui/trainingMeta';

const ICON: Record<NotificationType, IoniconName> = {
  session_confirmed: 'checkmark-circle-outline',
  session_cancelled: 'close-circle-outline',
  removed_from_session: 'person-remove-outline',
  session_rescheduled: 'time-outline',
  credits_granted: 'wallet-outline',
};

/**
 * The in-app notification centre — a sibling to Sessions in tone. The full feed
 * (newest first, live via Realtime), each row deep-linking to its session or the
 * wallet. Opening the centre marks everything read (read_at is the only column RLS
 * lets the player write), so the bell badge clears — but we snapshot which were unread
 * on entry so this view still styles them, and works fully whether or not push is on.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const q = useNotifications();
  const { mutate: markAllRead } = useMarkAllNotificationsRead();

  // Mark everything read once, on open — read_at is the only column RLS lets the player
  // write, and this clears the bell badge. Rows render their unread styling straight
  // from the live read_at, so they show as unread on entry and settle to read after the
  // mutation refetches. (A guard ref written in the effect, never read during render.)
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !q.data) return;
    marked.current = true;
    if (q.data.some((n) => n.readAt === null)) markAllRead(now);
  }, [q.data, now, markAllRead]);

  if (!player) return null;

  if (q.isPending || q.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your account" title="Notifications" onBack={() => router.back()} />
        {q.isPending ? <LoadingView /> : <ErrorView onRetry={q.refetch} />}
      </Screen>
    );
  }

  const notifications = q.data ?? [];

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Your account" title="Notifications" onBack={() => router.back()} />

      {notifications.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="You're all caught up"
          message="Confirmations, cancellations, reschedules and credit grants will show up here."
        />
      ) : (
        notifications.map((n) => (
          <NotificationRow
            key={n.id}
            notification={n}
            unread={n.readAt === null}
            relative={formatRelativeTime(n.createdAt, now)}
            onPress={() => router.push(notificationHref({ type: n.type, slotId: n.slotId }))}
          />
        ))
      )}
    </Screen>
  );
}

function NotificationRow({
  notification,
  unread,
  relative,
  onPress,
}: {
  notification: Notification;
  unread: boolean;
  relative: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconWrap, unread && styles.iconWrapUnread]}>
            <Ionicons
              name={ICON[notification.type]}
              size={20}
              color={unread ? color.accent.default : color.text.secondary}
            />
          </View>
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text variant="body" weight="bold" style={styles.title}>
                {notification.title}
              </Text>
              {unread ? <View style={styles.dot} /> : null}
            </View>
            <Text variant="caption" tone="secondary">
              {notification.body}
            </Text>
            <Text variant="caption" tone="muted" style={styles.time}>
              {relative}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapUnread: { backgroundColor: color.accent.soft },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent.default, marginStart: space.sm },
  time: { marginTop: space.xs },
});
