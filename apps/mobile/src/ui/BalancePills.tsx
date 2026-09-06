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
 *
 * TRIAL is deliberately absent: it's a once-per-player credit, so for everyone who
 * has already used theirs the pill was a permanent dimmed "0 Trial", and for the few
 * who still hold one the batch card further down the Wallet already names it
 * ("Welcome Trial Credits", with its own remaining/total). Nothing is hidden by
 * dropping it here — only the duplicate.
 *
 * NOTE the headline above these pills (totalReadyToBook) still COUNTS a trial credit,
 * because a trial credit genuinely is ready to book. So for a player holding one, the
 * pills won't sum to the headline. That's the deliberate trade: excluding trial from
 * the total too would make a trial-only player read "0 credits ready to book now"
 * while holding a bookable credit, which is a worse lie than a non-obvious sum.
 */
const PILL_TYPES = TRAINING_TYPES.filter((t) => t !== 'trial');

export function BalancePills({ balance }: { balance: Record<TrainingType, number> }) {
  return (
    <View style={styles.pills}>
      {PILL_TYPES.map((t) => (
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
