import { color, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

export type ScreenTone = 'light' | 'navy';

/**
 * Safe-area screen wrapper. The bottom inset is NEVER consumed as fixed container
 * padding (which left a dead gap on stack screens); instead:
 *  - `scroll` content extends to the bottom edge and pads its content by the inset
 *    so the last item scrolls clear of the home indicator;
 *  - a sticky `footer` (e.g. a Buy CTA) sits at the bottom with the inset applied
 *    beneath it — no gap under the button.
 * `tabBar` marks a tab screen: the top inset is still applied, but the bottom
 * inset is NOT (the tab bar already occupies it) — avoids double-padding.
 * `tone='navy'` powers NavyScreen. RTL-safe.
 */
export function Screen({
  children,
  tone = 'light',
  scroll = false,
  padded = true,
  tabBar = false,
  contentContainerStyle,
  footer,
  style,
}: {
  children?: ReactNode;
  tone?: ScreenTone;
  scroll?: boolean;
  padded?: boolean;
  tabBar?: boolean;
  contentContainerStyle?: ViewStyle;
  footer?: ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const isNavy = tone === 'navy';
  const bg = isNavy ? color.bg.inverse : color.bg.canvas;
  // Top/sides from the safe area; bottom handled below as content/footer padding.
  const edges: readonly Edge[] = ['top', 'left', 'right'];
  // The footer or the tab bar owns the bottom inset; otherwise the content does.
  const bottomPad = (footer || tabBar ? 0 : insets.bottom) + space.xl;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        padded ? styles.padded : null,
        contentContainerStyle,
        // Last so the inset wins over any `padding` shorthand in contentContainerStyle.
        { paddingBottom: bottomPad },
      ]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded ? styles.padded : null, style, { paddingBottom: bottomPad }]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={edges}>
      {body}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: insets.bottom + space.md,
              backgroundColor: bg,
              borderTopColor: isNavy ? color.border.onInverse : color.border.subtle,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  padded: { padding: space.xl },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
  },
});
