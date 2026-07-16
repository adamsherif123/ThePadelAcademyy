import Ionicons from '@expo/vector-icons/Ionicons';
import { color, creditExpiry, radius, space, type TintPair } from '@tpa/theme';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'onInverse';

const TONE: Record<BadgeTone, TintPair> = {
  neutral: { fg: color.text.secondary, bg: color.bg.canvas },
  success: creditExpiry.ok, //           green fg/bg pair
  warning: creditExpiry.expiring_soon, // amber fg/bg pair
  danger: creditExpiry.expired, //        red fg/bg pair
  onInverse: { fg: color.pillOnInverse.text, bg: color.pillOnInverse.bg },
};

/**
 * Pill/badge with an optional leading icon. Type pills (Group/Duo/… with an icon)
 * use the `neutral` tone; expiry uses StatusChip instead. The `onInverse` tone is
 * the hero's translucent-on-navy style. RTL-safe.
 */
export function Badge({
  label,
  tone = 'neutral',
  tint,
  icon,
  style,
}: {
  label: string;
  tone?: BadgeTone;
  tint?: TintPair;
  icon?: IoniconName;
  style?: ViewStyle;
}) {
  const pair = tint ?? TONE[tone];
  const border = tone === 'onInverse' ? color.pillOnInverse.border : pair.bg;
  return (
    <View style={[styles.base, { backgroundColor: pair.bg, borderColor: border }, style]}>
      {icon ? <Ionicons name={icon} size={13} color={pair.fg} /> : null}
      <Text variant="label" style={{ color: pair.fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
});
