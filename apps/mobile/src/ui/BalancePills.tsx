import { space } from '@tpa/theme';
import type { TrainingType } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { visibleBalanceTypes } from '../data/wallet';
import { PillOnNavy } from './PillOnNavy';
import { TRAINING_META } from './trainingMeta';

/**
 * The per-type credit-balance pills for the navy summary card (Wallet only —
 * Home shows the total, not the breakdown). Zero-balance pills dim. Passed as
 * children to CreditsSummaryCard so the shell stays composition-agnostic. RTL-safe.
 *
 * TRIAL is the one conditional pill: it's a once-per-player credit, so for everyone
 * who has already used theirs a permanent dimmed "0 Trial" was pure clutter. It
 * renders only while the player actually holds one, and dims for nothing — Group,
 * Duo and Individual keep rendering at zero, since those are the types you can go
 * and buy.
 *
 * Which types are visible is `visibleBalanceTypes` (data/wallet), where the
 * tally-to-the-headline invariant is documented and unit-tested.
 */
export function BalancePills({ balance }: { balance: Record<TrainingType, number> }) {
  const types = visibleBalanceTypes(balance);
  return (
    <View style={styles.pills}>
      {types.map((t) => (
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
