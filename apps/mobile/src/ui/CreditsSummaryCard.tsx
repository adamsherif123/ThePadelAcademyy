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
  return (
    <Card variant="inverse">
      {eyebrow ? (
        <Text variant="label" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}

      {/* Total + caption at the start, action chip at the end, vertically aligned.
          The count block flexes so a big total keeps its room; the chip holds its
          intrinsic size (never shrinks) and re-centers itself in the row. */}
      <View style={styles.headRow}>
        <View style={styles.count}>
          <Text variant="display" tone="inverse">
            {String(total)}
          </Text>
          <Text variant="caption" tone="inverse">
            {caption}
          </Text>
        </View>
        {action ? (
          <PillOnNavy
            label={action.label}
            icon={action.icon}
            trailingIcon={action.trailingIcon}
            onPress={action.onPress}
            style={styles.chip}
          />
        ) : null}
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

      {expiringText ? (
        <InfoCard variant="amber" size="sm" style={styles.strip} text={expiringText} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Flexes to claim the row's remaining width so the big total is never squeezed.
  count: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Overrides PillOnNavy's flex-start so the chip centres with the total; keeps
  // its intrinsic size (RN children don't shrink by default) so the label can't clip.
  chip: { alignSelf: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  strip: { marginTop: space.md },
});
