import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useUnseenNews } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The news entry point: a newspaper icon with a plain unseen-dot (no count — news
 * is "there's something new," not a tally to clear). `useUnseenNews` is the SAME
 * shared derivation the pop-up and the feed use, so the dot never disagrees with
 * what they show. Sits in the Home header, where the inert first-initial Avatar
 * used to be.
 */
export function NewsButton() {
  const router = useRouter();
  const { color } = useTheme();
  const { now } = useSession();
  const unseenQ = useUnseenNews(now);
  const hasUnseen = (unseenQ.data ?? []).length > 0;
  const styles = useMemo(
    () => StyleSheet.create({
      dot: {
        position: 'absolute',
        top: -2,
        end: -2,
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color.status.danger,
        borderWidth: 1.5,
        borderColor: color.bg.canvas,
      },
    }),
    [color],
  );

  return (
    <Pressable
      onPress={() => router.push('/news')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={hasUnseen ? 'News, unseen updates' : 'News'}
    >
      <Ionicons name="newspaper-outline" size={24} color={color.text.primary} />
      {hasUnseen ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}
