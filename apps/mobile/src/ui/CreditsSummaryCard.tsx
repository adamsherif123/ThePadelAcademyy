import { space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from './Card';
import { PillOnNavy } from './PillOnNavy';
import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/** Top-end action chip (Home: "Wallet →"; Wallet: "+ Buy credits"). */
export interface SummaryAction {
  label: string;
  icon?: IoniconName;
  trailingIcon?: IoniconName;
  onPress: () => void;
}

/**
 * The navy credits summary — the app's signature wallet element, shared by Home
 * and the Wallet screen. A SHELL: it owns only what both screens share — the navy
 * card, the optional eyebrow, and the head row (big total + caption at the start,
 * the action chip at the end). Everything that diverges is `children`: Wallet
 * passes <BalancePills>, Home passes its dismissible expiry notice. Keeping the
 * head row here means the signature can't drift between the two screens, while the
 * children slot keeps each screen's intent explicit instead of behind flags.
 */
export function CreditsSummaryCard({
  total,
  caption = 'credits\nready to book',
  eyebrow,
  action,
  children,
}: {
  total: number;
  caption?: string;
  eyebrow?: string;
  action?: SummaryAction;
  children?: ReactNode;
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

      {children ? <View style={styles.below}>{children}</View> : null}
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
  below: { marginTop: space.md },
});
