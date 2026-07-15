import { creditExpiryState, formatExpiry } from '@tpa/core';
import { creditExpiry, radius, space, trainingTint } from '@tpa/theme';
import type { CreditBatch, IsoInstant } from '@tpa/types';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';

const TYPE_LABEL: Record<CreditBatch['trainingType'], string> = {
  trial: 'Trial',
  group: 'Group',
  duo: 'Duo',
  individual: 'Individual',
};

/**
 * The wallet's core visual: a typed credit balance tinted by TrainingType, with
 * its expiry state (ok / expiring_soon / expired) shown via formatExpiry and the
 * matching status color. Design against the mock grant batches (fresh / partly
 * used / expired). RTL-safe: logical row with `gap`, no physical props.
 */
export function CreditPill({
  batch,
  now,
  style,
}: {
  batch: CreditBatch;
  now: IsoInstant;
  style?: ViewStyle;
}) {
  const tint = trainingTint[batch.trainingType];
  const state = creditExpiryState(batch.expiresAt, now);
  const expiry = creditExpiry[state];

  return (
    <View style={[styles.base, { backgroundColor: tint.bg, borderColor: tint.fg }, style]}>
      <View style={styles.header}>
        <Text variant="label" style={{ color: tint.fg }}>
          {TYPE_LABEL[batch.trainingType]}
        </Text>
        <Text variant="h2" style={{ color: tint.fg }}>
          {batch.quantityRemaining}
          <Text variant="caption" style={{ color: tint.fg }}>
            {' '}
            / {batch.quantityTotal}
          </Text>
        </Text>
      </View>
      <View style={[styles.expiry, { backgroundColor: expiry.bg }]}>
        <Text variant="caption" style={{ color: expiry.fg }}>
          {formatExpiry(batch.expiresAt, now)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.lg,
    gap: space.sm,
    minWidth: 150,
  },
  header: { gap: space.xs },
  expiry: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
});
