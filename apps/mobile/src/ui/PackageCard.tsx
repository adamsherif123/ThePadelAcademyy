import { space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { Badge } from './Badge';
import { BestValueBadge, isBestValuePackage } from './BestValueBadge';
import { Card } from './Card';
import { Money } from './Money';
import { Text } from './Text';
import { TRAINING_META } from './trainingMeta';

/**
 * The Home top-up carousel card (the vertical counterpart to PackageRow). The
 * type pill and BEST VALUE badge share a header ROW — pill at the start, badge at
 * the end — so they can never overlap, at any label length or system font size.
 * The best-value rule + badge come from BestValueBadge (one implementation, also
 * used by PackageRow). Money via @tpa/core; the per-session unit is pure math.
 */
export function PackageCard({ pkg, onPress }: { pkg: Package; onPress?: () => void }) {
  const meta = TRAINING_META[pkg.trainingType];
  const isSingle = pkg.sessionCount === 1;
  const perSession = Math.round(pkg.price / pkg.sessionCount) as Piastres;

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Badge label={meta.label} icon={meta.icon} />
        {isBestValuePackage(pkg) ? <BestValueBadge /> : null}
      </View>

      <Text variant="h2">{`${pkg.sessionCount} Sessions`}</Text>
      <Money amount={pkg.price} tone="accent" variant="h2" numberOfLines={1} />
      {isSingle ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          Single session
        </Text>
      ) : (
        <View style={styles.perSession}>
          <Money amount={perSession} variant="caption" tone="muted" numberOfLines={1} />
          <Text variant="caption" tone="muted">
            {' / session'}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: 200, gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  perSession: { flexDirection: 'row', alignItems: 'center' },
});
