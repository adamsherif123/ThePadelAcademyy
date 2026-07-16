import { color, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

/**
 * Full-bleed deep-navy screen — the auth / onboarding surface. The app proper
 * stays on the light canvas (see Screen); this dark-auth / light-app split
 * mirrors the academy's website. Text inside should use the `inverse` tone.
 * RTL-safe: symmetric padding only.
 */
export function NavyScreen({
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
  safe: { flex: 1, backgroundColor: color.bg.inverse },
  body: { flex: 1 },
  padded: { padding: space.xl },
});
