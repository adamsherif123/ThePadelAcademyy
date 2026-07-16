import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * An icon row in one of two layouts:
 *  - title/subtitle (default) — the academy / next-session rows;
 *  - label/value (pass `label` + `value`) — the DATE / TIME / LOCATION rows on
 *    the confirm screen, where a small uppercase label sits beside a bold value.
 * Pass `chip` to render the icon in a tinted rounded-square (per the confirm
 * design). `tone='navy'` for inverse surfaces. RTL-safe.
 */
export function IconRow({
  icon,
  title,
  subtitle,
  label,
  value,
  chip = false,
  tone = 'light',
}: {
  icon: IoniconName;
  title?: string;
  subtitle?: string;
  label?: string;
  value?: string;
  chip?: boolean;
  tone?: 'light' | 'navy';
}) {
  const isNavy = tone === 'navy';
  const iconColor = isNavy ? color.text.inverse : color.accent.default;

  const iconEl = chip ? (
    <View style={[styles.chip, isNavy && styles.chipNavy]}>
      <Ionicons name={icon} size={16} color={iconColor} />
    </View>
  ) : (
    <Ionicons name={icon} size={18} color={iconColor} style={styles.bareIcon} />
  );

  if (label !== undefined) {
    return (
      <View style={styles.rowCentered}>
        {iconEl}
        <Text variant="label" tone="secondary" style={styles.label}>
          {label}
        </Text>
        <Text variant="body" weight="bold" tone={isNavy ? 'inverse' : 'primary'} style={styles.value}>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {iconEl}
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
  rowCentered: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  bareIcon: { marginTop: 2 },
  chip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: color.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipNavy: { backgroundColor: color.pillOnInverse.bg },
  col: { flex: 1, gap: 2 },
  label: { minWidth: 72 },
  value: { flex: 1 },
});
