import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * Icon + title (+ optional subtitle) row — the DATE / TIME / LOCATION style rows
 * (academy card, next-session card). `tone='navy'` for use on inverse surfaces.
 * RTL-safe: leading icon via row + gap, logical alignment.
 */
export function IconRow({
  icon,
  title,
  subtitle,
  tone = 'light',
}: {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  tone?: 'light' | 'navy';
}) {
  const isNavy = tone === 'navy';
  const iconColor = isNavy ? color.text.inverse : color.accent.default;
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={iconColor} style={styles.icon} />
      <View style={styles.col}>
        <Text variant="body" weight="bold" tone={isNavy ? 'inverse' : 'primary'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone={isNavy ? 'inverse' : 'secondary'}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  icon: { marginTop: 2 },
  col: { flex: 1, gap: 2 },
});
