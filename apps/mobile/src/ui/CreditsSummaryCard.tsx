import { TRAINING_TYPES } from '@tpa/core';
import { space } from '@tpa/theme';
import type { TrainingType } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { Card } from './Card';
import { InfoCard } from './InfoCard';
import { PillOnNavy } from './PillOnNavy';
import { Text } from './Text';
import { TRAINING_META } from './trainingMeta';

/**
 * The navy credits summary — the app's signature wallet element, shown on Home
 * (with a wallet link + expiry strip) and on the Wallet screen (plain). Balance
 * pills dim at zero. Composition only; screens pass computed numbers.
 */
export function CreditsSummaryCard({
  total,
  balance,
  caption = 'credits\nready to book',
  onWallet,
  expiringText,
}: {
  total: number;
  balance: Record<TrainingType, number>;
  caption?: string;
  onWallet?: () => void;
  expiringText?: string;
}) {
  return (
    <Card variant="inverse">
      <View style={styles.top}>
        <Text variant="label">Your credits</Text>
        {onWallet ? (
          <PillOnNavy label="Wallet" trailingIcon="arrow-forward" onPress={onWallet} />
        ) : null}
      </View>

      <View style={styles.count}>
        <Text variant="display" tone="inverse">
          {String(total)}
        </Text>
        <Text variant="caption" tone="inverse">
          {caption}
        </Text>
      </View>

      <View style={styles.pills}>
        {TRAINING_TYPES.map((t) => (
          <PillOnNavy
            key={t}
            icon={TRAINING_META[t].icon}
            label={`${balance[t]} ${TRAINING_META[t].label}`}
            dimmed={balance[t] === 0}
          />
        ))}
      </View>

      {expiringText ? <InfoCard variant="amber" style={styles.strip} text={expiringText} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  strip: { marginTop: space.md },
});
