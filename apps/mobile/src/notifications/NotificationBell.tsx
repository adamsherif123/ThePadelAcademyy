import Ionicons from '@expo/vector-icons/Ionicons';
import { color } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useNotifications } from '../data/queries';
import { Text } from '../ui';

/**
 * The notification-centre entry point: a bell with an unread badge (count of read_at
 * IS NULL). The count comes from the same live-by-Realtime query the centre uses, so
 * it updates instantly — push or not. Sits in the Home header.
 */
export function NotificationBell() {
  const router = useRouter();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => n.readAt === null).length;

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Ionicons name="notifications-outline" size={24} color={color.text.primary} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text variant="caption" weight="bold" style={styles.badgeText}>
            {unread > 9 ? '9+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -5,
    end: -6,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: color.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: color.text.inverse, fontSize: 10, lineHeight: 13 },
});
