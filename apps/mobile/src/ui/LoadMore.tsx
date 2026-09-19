import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, space } from '@tpa/theme';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useMemo } from 'react';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * The "there is more, older stuff below" affordance at the foot of a cursor-paged
 * list (the Sessions tab's Past history, the notification centre).
 *
 * Deliberately NOT a `Button`: a full-width 54px uppercase pill reads as the
 * screen's primary action, which is exactly wrong for a quiet bit of list
 * navigation sitting under the content it extends. This is a small centred chip —
 * hugging its label, sentence case, muted — that recedes until you look for it.
 *
 * The chevron is the thing doing the explaining: it points down, at where the
 * older rows will appear. While a page is in flight it becomes a spinner in the
 * SAME slot and the label is unchanged, so the chip neither resizes nor reflows
 * the list under the reader's thumb.
 */
export function LoadMore({
  onPress,
  loading = false,
  label = 'Show older',
}: {
  onPress: () => void;
  loading?: boolean;
  label?: string;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        chip: {
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          marginTop: space.xs,
          minHeight: 34,
          paddingVertical: space.xs,
          paddingHorizontal: space.md,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: color.border.subtle,
          backgroundColor: color.bg.surface,
        },
        pressed: { backgroundColor: color.bg.canvas },
        // Fixed slot, so swapping the chevron for the spinner cannot shift the label.
        glyph: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
        // RN's "small" indicator is 20dp; scaled to sit in the 14dp glyph slot.
        spinner: { transform: [{ scale: 0.7 }] },
      }),
    [color],
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ busy: loading }}
      accessibilityLabel={label}
      // A 34px chip is under the 44px touch target, so the tappable area is grown
      // outwards rather than the chip being drawn bigger than it should look.
      hitSlop={space.sm}
      style={({ pressed }) => [styles.chip, pressed && !loading ? styles.pressed : null]}
    >
      <Text variant="caption" weight="semibold" tone="secondary">
        {label}
      </Text>
      <View style={styles.glyph}>
        {loading ? (
          <ActivityIndicator size="small" color={color.text.muted} style={styles.spinner} />
        ) : (
          <Ionicons name="chevron-down" size={14} color={color.text.muted} />
        )}
      </View>
    </Pressable>
  );
}
