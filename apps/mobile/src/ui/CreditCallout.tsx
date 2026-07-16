import { color, radius, space } from '@tpa/theme';
import type { IsoInstant } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { StatusChip } from './StatusChip';
import { Text } from './Text';

/**
 * The royal-bordered "this will use 1 credit" callout on the confirm screen. A
 * white card with a royal border: an accent headline, the after-booking balance
 * line, and the source batch with its expiry StatusChip. All values are computed
 * by the screen (via @tpa/core); this is pure presentation. RTL-safe.
 */
export function CreditCallout({
  headline,
  detail,
  source,
  expiresAt,
  now,
}: {
  headline: string;
  detail: string;
  source: string;
  expiresAt: IsoInstant;
  now: IsoInstant;
}) {
  return (
    <View style={styles.card}>
      <Text variant="label" tone="accent">
        {headline}
      </Text>
      <Text variant="body">{detail}</Text>
      <View style={styles.sourceRow}>
        <Text variant="caption" tone="secondary">
          {`From: ${source}`}
        </Text>
        <StatusChip expiresAt={expiresAt} now={now} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.bg.surface,
    borderColor: color.accent.default,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
  },
});
