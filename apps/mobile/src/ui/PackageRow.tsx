import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from './Badge';
import { Money } from './Money';
import { Text } from './Text';

/**
 * A buy-credits list row: session-count tile + royal price + per-session price +
 * chevron, with a BEST VALUE badge on 8-packs.
 *
 * Layout is built to survive real content and Dynamic Type:
 *  - the tile label ("SESSIONS") is a `micro` token, single line, auto-shrinks;
 *  - the price is primary info and NEVER wraps (numberOfLines=1);
 *  - the price column takes priority (flexShrink 1 with room), while the BEST
 *    VALUE badge is the element that yields (flexShrink) when space is tight.
 * The per-session unit price is derived here (pure math); everything else a token.
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
        <Text variant="h2" numberOfLines={1}>
          {String(pkg.sessionCount)}
        </Text>
        <Text variant="micro" numberOfLines={1} adjustsFontSizeToFit style={styles.tileLabel}>
          {isSingle ? 'Session' : 'Sessions'}
        </Text>
      </View>

      <View style={styles.info}>
        <Money amount={pkg.price} tone="accent" variant="h2" numberOfLines={1} />
        {isSingle ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            Single session
          </Text>
        ) : (
          <View style={styles.perSession}>
            <Money amount={perSession} variant="caption" tone="secondary" numberOfLines={1} />
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {' / session'}
            </Text>
          </View>
        )}
      </View>

      {isBestValue ? (
        <View style={styles.badge}>
          <Badge label="Best value" tint={{ fg: color.text.inverse, bg: color.accent.default }} />
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={20} color={color.text.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.bg.surface,
    borderColor: color.border.subtle,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  pressed: { opacity: 0.7 },
  tile: {
    width: 56,
    minHeight: 56,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tileLabel: { alignSelf: 'stretch', textAlign: 'center' },
  info: { flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 2 },
  perSession: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' },
  badge: { flexShrink: 1 },
});
