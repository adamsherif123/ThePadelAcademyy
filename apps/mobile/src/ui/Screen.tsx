import { color, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

/**
 * Safe-area screen wrapper on the canvas background. `padded` adds the standard
 * gutter. RTL-safe: only symmetric padding.
 */
export function Screen({
  children,
  padded = true,
  edges = ['top', 'bottom', 'left', 'right'],
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.body, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg.canvas },
  body: { flex: 1 },
  padded: { padding: space.xl },
});
