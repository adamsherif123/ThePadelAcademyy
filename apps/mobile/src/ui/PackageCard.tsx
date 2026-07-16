import { space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { Badge } from './Badge';
import { Card } from './Card';
import { Money } from './Money';
import { Text } from './Text';
import { TRAINING_META } from './trainingMeta';

/**
 * The Home top-up carousel card (a narrow teaser that routes to /buy-credits).
 * Deliberately no BEST VALUE badge: the card is too narrow to fit it without
 * clipping, and the real comparison happens on /buy-credits (see PackageRow,
 * which keeps the badge). Money via @tpa/core; the per-session unit is pure math.
 */
export function PackageCard({ pkg, onPress }: { pkg: Package; onPress?: () => void }) {
  const meta = TRAINING_META[pkg.trainingType];
  const isSingle = pkg.sessionCount === 1;
  const perSession = Math.round(pkg.price / pkg.sessionCount) as Piastres;

  return (
    <Card style={styles.card} onPress={onPress}>
      <Badge label={meta.label} icon={meta.icon} />
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
  perSession: { flexDirection: 'row', alignItems: 'center' },
});
