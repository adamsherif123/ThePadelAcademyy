import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text, type TextTone } from './Text';
import type { IoniconName } from './trainingMeta';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface VariantColors {
  bg: string;
  bgPressed: string;
  bgDisabled: string;
  border?: string;
  label: TextTone;
  labelDisabled: TextTone;
  labelColor: string;
}

const VARIANT: Record<ButtonVariant, VariantColors> = {
  primary: {
    bg: color.accent.default,
    bgPressed: color.accent.pressed,
    bgDisabled: color.accent.disabled,
    label: 'inverse',
    labelDisabled: 'inverse',
    labelColor: color.text.inverse,
  },
  secondary: {
    bg: color.bg.surface,
    bgPressed: color.bg.canvas,
    bgDisabled: color.bg.surface,
    border: color.border.strong,
    label: 'primary',
    labelDisabled: 'muted',
    labelColor: color.text.primary,
  },
  ghost: {
    bg: 'transparent',
    bgPressed: color.bg.canvas,
    bgDisabled: 'transparent',
    label: 'accent',
    labelDisabled: 'muted',
    labelColor: color.accent.default,
  },
};

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon, colored like the label. */
  icon?: IoniconName;
  /** Destructive action — colors the label/icon danger red (secondary/ghost). */
  destructive?: boolean;
  style?: ViewStyle;
}

/**
 * Primary / secondary / ghost full-pill button with default, pressed, disabled
 * and loading states, an optional leading icon, and a destructive mode. RTL-safe
 * (symmetric padding, no physical props).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  destructive = false,
  style,
}: ButtonProps) {
  const v = VARIANT[variant];
  const isInert = disabled || loading;
  const labelColor = destructive ? color.status.danger : v.labelColor;

  return (
    <Pressable
      onPress={onPress}
      disabled={isInert}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: disabled ? v.bgDisabled : pressed ? v.bgPressed : v.bg },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={color.text.inverse} /> : null}
        {icon && !loading ? <Ionicons name={icon} size={18} color={labelColor} /> : null}
        <Text
          variant="body"
          weight="bold"
          tone={disabled ? v.labelDisabled : v.label}
          style={[styles.label, destructive ? { color: labelColor } : null]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { textTransform: 'uppercase', letterSpacing: 0.5 },
  disabled: { opacity: 0.85 },
});
