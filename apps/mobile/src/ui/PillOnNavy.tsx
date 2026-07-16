import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * Translucent white pill for navy surfaces (the hero's balance/format pills and
 * the auth GROUP/DUO/INDIVIDUAL pills). `dimmed` fades zero-balance pills.
 * RTL-safe.
 */
export function PillOnNavy({
  label,
  icon,
  trailingIcon,
  dimmed = false,
  style,
}: {
  label: string;
  icon?: IoniconName;
  trailingIcon?: IoniconName;
  dimmed?: boolean;
  style?: ViewStyle;
}) {
  const fg = color.pillOnInverse.text;
  return (
    <View style={[styles.base, dimmed && styles.dimmed, style]}>
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text variant="label" weight="bold" style={[styles.label, { color: fg }]}>
        {label}
      </Text>
      {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={fg} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    backgroundColor: color.pillOnInverse.bg,
    borderColor: color.pillOnInverse.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  dimmed: { opacity: 0.45 },
  label: { letterSpacing: 0.4 },
});
