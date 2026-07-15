import { color, radius, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { shadow } from '../theme/shadow';

export type CardVariant = 'surface' | 'inverse';

/**
 * A rounded, elevated surface. `surface` = white card on canvas; `inverse` = deep
 * navy (hero / balance cards). Text placed inside an inverse card should use the
 * `inverse` tone. RTL-safe.
 */
export function Card({
  children,
  variant = 'surface',
  style,
}: {
  children: ReactNode;
  variant?: CardVariant;
  style?: ViewStyle;
}) {
  const isInverse = variant === 'inverse';
  return (
    <View
      style={[
        styles.base,
        shadow('md'),
        {
          backgroundColor: isInverse ? color.bg.inverse : color.bg.surface,
          borderColor: isInverse ? color.border.onInverse : color.border.subtle,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.xl,
  },
});
