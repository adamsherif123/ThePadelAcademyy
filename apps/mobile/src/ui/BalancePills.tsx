import { TRAINING_TYPES } from '@tpa/core';
import { space } from '@tpa/theme';
import type { TrainingType } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { PillOnNavy } from './PillOnNavy';
import { TRAINING_META } from './trainingMeta';

/**
 * The per-type credit-balance pills for the navy summary card (Wallet only —
 * Home shows the total, not the breakdown). Zero-balance pills dim. Passed as
 * children to CreditsSummaryCard so the shell stays composition-agnostic. RTL-safe.
 */
export function BalancePills({ balance }: { balance: Record<TrainingType, number> }) {
  return (
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
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
