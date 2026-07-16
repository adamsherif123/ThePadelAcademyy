import { TRAINING_TYPES } from '@tpa/core';
import { space } from '@tpa/theme';
import type { TrainingType } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { Card } from './Card';
import { InfoCard } from './InfoCard';
import { PillOnNavy } from './PillOnNavy';
import { Text } from './Text';
import { TRAINING_META, type IoniconName } from './trainingMeta';

/** Top-right action chip (Home: "Wallet →"; Wallet: "+ Buy credits"). */
export interface SummaryAction {
  label: string;
  icon?: IoniconName;
  trailingIcon?: IoniconName;
  onPress: () => void;
}

/**
 * The navy credits summary — the app's signature wallet element, shared by Home
 * and the Wallet screen. The eyebrow is OPT-IN (`eyebrow` prop): Home shows one,
 * the Wallet screen omits it to avoid repeating its "YOUR CREDITS" page title.
 * The top-right `action` chip slot carries Home's Wallet link and Wallet's Buy
 * chip. Balance pills dim at zero. Composition only; screens pass computed numbers.
 */
export function CreditsSummaryCard({
  total,
  balance,
  caption = 'credits\nready to book',
  eyebrow,
  action,
  expiringText,
}: {
  total: number;
  balance: Record<TrainingType, number>;
  caption?: string;
  eyebrow?: string;
  action?: SummaryAction;
  expiringText?: string;
}) {
  const hasTopRow = Boolean(eyebrow || action);

  return (
    <Card variant="inverse">
      {hasTopRow ? (
        <View style={[styles.top, { justifyContent: eyebrow ? 'space-between' : 'flex-end' }]}>
          {eyebrow ? <Text variant="label">{eyebrow}</Text> : null}
          {action ? (
            <PillOnNavy
              label={action.label}
              icon={action.icon}
              trailingIcon={action.trailingIcon}
              onPress={action.onPress}
            />
          ) : null}
        </View>
      ) : null}

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
  top: { flexDirection: 'row', alignItems: 'center' },
  count: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  strip: { marginTop: space.md },
});
