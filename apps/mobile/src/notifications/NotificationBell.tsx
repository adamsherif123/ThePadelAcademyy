import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useUnreadNotificationCount } from '../data/queries';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

/**
 * The notification-centre entry point: a bell with an unread badge (count of read_at
 * IS NULL). The count is its own head:true COUNT query — it used to be derived by
 * pulling every notification the player has ever had and filtering in JS, which is
 * the one thing a badge should never cost. It shares the ['notifications'] key prefix
 * with the centre's feed, so Realtime still updates it instantly — push or not.
 * Sits in the Home header.
 */
export function NotificationBell() {
  const router = useRouter();
  const { color } = useTheme();
  const unread = useUnreadNotificationCount().data ?? 0;
  const styles = useMemo(
    () => StyleSheet.create({
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
    }),
    [color],
  );

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
