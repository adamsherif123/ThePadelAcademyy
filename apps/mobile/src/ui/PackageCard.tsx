import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPiastres } from '@tpa/core';
import { letterSpacing, radius, space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { Money } from './Money';
import { Text } from './Text';
import { TRAINING_META } from './trainingMeta';

/**
 * The Home top-up carousel card — a narrow teaser that opens the package.
 *
 * ── one number, and everything else quiet ──
 * It used to set the session count and the price at the same size (h2), inside a
 * filled badge and the standard card's generous padding, which made a shortcut
 * card look like a page. There is only one thing a player compares across a
 * horizontal strip, and it is the price: that is the single large element now,
 * and the type, the count and the per-session value are all small supporting
 * text. The card came down from 200dp wide with 24dp padding to 164/16, so two
 * and a bit are in view instead of one and a half, and the strip reads as a row
 * of options rather than a stack of cards.
 *
 * ── a label row, not a filled pill ──
 * A badge is a status. The training type here is a category, and it sits above
 * the price as a small uppercase line with its icon, which is lighter and leaves
 * the price the only thing with weight. The chevron shares that row rather than
 * taking its own: the card is tappable and should say so, and a chevron floating
 * alone in a 164dp card is clutter.
 *
 * Deliberately no BEST VALUE badge: the card is too narrow to fit it without
 * clipping, and the real comparison happens on /buy-credits (see PackageRow,
 * which keeps the badge). Money always via @tpa/core's formatter.
 */
export function PackageCard({ pkg, onPress }: { pkg: Package; onPress?: () => void }) {
  const { color } = useTheme();
  const meta = TRAINING_META[pkg.trainingType];
  const isSingle = pkg.sessionCount === 1;
  const perSession = Math.round(pkg.price / pkg.sessionCount) as Piastres;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // Padding overrides Card's own (space.xl): it is sized for a full-width
        // block of content, and this is a teaser.
        card: { width: 164, padding: space.lg, borderRadius: radius.lg, gap: space.sm },
        labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
        // The label yields and the chevron never does — a long type name
        // truncates rather than pushing the affordance off the card.
        label: { flex: 1, letterSpacing: letterSpacing.label },
        price: { marginTop: space.xs },
      }),
    [],
  );

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.labelRow}>
        <Ionicons name={meta.icon} size={13} color={color.text.muted} />
        <Text variant="micro" tone="muted" weight="bold" style={styles.label} numberOfLines={1}>
          {meta.label.toUpperCase()}
        </Text>
        {onPress ? <Ionicons name="chevron-forward" size={13} color={color.text.muted} /> : null}
      </View>

      <View style={styles.price}>
        <Money amount={pkg.price} tone="accent" variant="h2" weight="bold" numberOfLines={1} />
      </View>

      {/* Count and unit value on ONE line. They are read together — "how many,
          and is that a good rate" is a single question — and two lines of
          caption under a price is the shape that made the old card tall.
          `1 session` says it alone: "500 EGP each" for a single session is the
          price restated, and the old card's "1 Sessions" was simply wrong. */}
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {isSingle
          ? '1 session'
          : `${pkg.sessionCount} sessions · ${formatPiastres(perSession)} each`}
      </Text>
    </Card>
  );
}
