import { color, radius, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { shadow } from '../theme/shadow';

export type CardVariant = 'surface' | 'inverse';

/**
 * A rounded, near-flat surface. `surface` = white card on canvas (radius.lg);
 * `inverse` = deep navy hero/summary card, which reads rounder (radius.xl). A
 * hairline border does the work; the shadow is only a whisper (elevation `card`).
 * Pass `onPress` to make the whole card tappable. Text inside an inverse card
 * should use the `inverse` tone. RTL-safe.
 */
export function Card({
  children,
  variant = 'surface',
  onPress,
  style,
}: {
  children: ReactNode;
  variant?: CardVariant;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const isInverse = variant === 'inverse';
  const composed = [
    styles.base,
    shadow('card'),
    {
      borderRadius: isInverse ? radius.xl : radius.lg,
      backgroundColor: isInverse ? color.bg.inverse : color.bg.surface,
      borderColor: isInverse ? color.border.onInverse : color.border.subtle,
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [composed, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={composed}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    padding: space.xl,
  },
  pressed: { opacity: 0.85 },
});

