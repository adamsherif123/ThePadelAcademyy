import { space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { CircleIconButton } from './CircleIconButton';
import { Text } from './Text';

/**
 * The brand's signature header, on every screen: a periwinkle uppercase tracked
 * eyebrow, then an extrabold UPPERCASE display heading. Optional circular back
 * chevron (inline-start) and an optional `trailing` slot (e.g. an Avatar). `tone`
 * controls title/back-button colors for light vs navy surfaces. RTL-safe.
 */
export function ScreenHeader({
  eyebrow,
  title,
  onBack,
  trailing,
  tone = 'light',
}: {
  eyebrow: string;
  title: string;
  onBack?: () => void;
  trailing?: ReactNode;
  tone?: 'light' | 'navy';
}) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <View style={styles.backRow}>
          <CircleIconButton onPress={onBack} tone={tone} />
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.titleCol}>
          <Text variant="label">{eyebrow}</Text>
          <Text variant="display" tone={tone === 'navy' ? 'inverse' : 'primary'}>
            {title}
          </Text>
        </View>
        {trailing ? <View style={styles.trailingCol}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.md },
  backRow: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleCol: { flex: 1, gap: space.xs },
  trailingCol: { alignItems: 'flex-end', justifyContent: 'center' },
});
