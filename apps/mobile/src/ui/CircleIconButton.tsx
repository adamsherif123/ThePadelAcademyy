import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius } from '@tpa/theme';
import { Pressable, StyleSheet } from 'react-native';

import type { IoniconName } from './trainingMeta';

/**
 * Circular icon button — the header back-chevron. `tone` matches the surface:
 * `light` = white circle / ink icon; `navy` = translucent circle / white icon.
 */
export function CircleIconButton({
  icon = 'chevron-back',
  onPress,
  tone = 'light',
  accessibilityLabel = 'Back',
}: {
  icon?: IoniconName;
  onPress?: () => void;
  tone?: 'light' | 'navy';
  accessibilityLabel?: string;
}) {
  const isNavy = tone === 'navy';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: isNavy ? color.pillOnInverse.bg : color.bg.surface,
          borderColor: isNavy ? color.pillOnInverse.border : color.border.subtle,
        },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={isNavy ? color.text.inverse : color.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
