import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from './Badge';
import { Money } from './Money';
import { Text } from './Text';

/**
 * A buy-credits list row: session-count tile + royal price + per-session price +
 * chevron, with a BEST VALUE badge on 8-packs. Money renders via @tpa/core. The
 * per-session unit price is derived here (pure math); everything else is a token.
 */
export function PackageRow({ pkg, onPress }: { pkg: Package; onPress?: () => void }) {
  const isSingle = pkg.sessionCount === 1;
  const isBestValue = pkg.sessionCount === 8;
  const perSession = Math.round(pkg.price / pkg.sessionCount) as Piastres;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.tile}>
        <Text variant="h1">{String(pkg.sessionCount)}</Text>
        <Text variant="caption" tone="muted" style={styles.tileLabel}>
          {isSingle ? 'Session' : 'Sessions'}
        </Text>
      </View>

      <View style={styles.info}>
        <Money amount={pkg.price} tone="accent" variant="h2" />
        {isSingle ? (
          <Text variant="caption" tone="secondary">
            Single session
          </Text>
        ) : (
          <View style={styles.perSession}>
            <Money amount={perSession} variant="caption" tone="secondary" />
            <Text variant="caption" tone="secondary">
              {' / session'}
            </Text>
          </View>
        )}
      </View>

      {isBestValue ? (
        <Badge label="Best value" tint={{ fg: color.text.inverse, bg: color.accent.default }} />
      ) : null}
      <Ionicons name="chevron-forward" size={20} color={color.text.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.bg.surface,
    borderColor: color.border.subtle,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  pressed: { opacity: 0.7 },
  tile: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: color.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { textTransform: 'uppercase', letterSpacing: 0.3 },
  info: { flex: 1, gap: 2 },
  perSession: { flexDirection: 'row', alignItems: 'center' },
});
