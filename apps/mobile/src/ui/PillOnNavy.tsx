import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * Translucent white pill for navy surfaces (the hero's balance/format pills and
 * the auth GROUP/DUO/INDIVIDUAL pills). `dimmed` fades zero-balance pills; pass
 * `onPress` to make it a button (e.g. the Wallet chip). RTL-safe.
 */
export function PillOnNavy({
  label,
  icon,
  trailingIcon,
  dimmed = false,
  onPress,
  style,
}: {
  label: string;
  icon?: IoniconName;
  trailingIcon?: IoniconName;
  dimmed?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const fg = color.pillOnInverse.text;
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text variant="label" weight="bold" style={[styles.label, { color: fg }]}>
        {label}
      </Text>
      {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={fg} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.base, dimmed && styles.dimmed, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.base, dimmed && styles.dimmed, style]}>{content}</View>;
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
  pressed: { opacity: 0.7 },
  label: { letterSpacing: 0.4 },
});
