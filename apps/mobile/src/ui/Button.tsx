import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text, type TextTone, type TextVariant } from './Text';
import type { IoniconName } from './trainingMeta';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

interface SizeSpec {
  minHeight: number;
  paddingHorizontal: number;
  labelVariant: TextVariant;
  gap: number;
  iconSize: number;
}

const SIZE: Record<ButtonSize, SizeSpec> = {
  // Primary CTAs and sticky footers: the full-height pill.
  md: { minHeight: 54, paddingHorizontal: space.xl, labelVariant: 'body', gap: space.sm, iconSize: 18 },
  // Inline / card-level actions: shorter, tighter, smaller label. Pairs with
  // fullWidth={false} to hug its content instead of reading as a CTA.
  sm: { minHeight: 40, paddingHorizontal: space.lg, labelVariant: 'caption', gap: space.xs, iconSize: 15 },
};

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
  size?: ButtonSize;
  /**
   * Whether the button stretches to fill its container's width (default true, the
   * CTA/footer shape). Set false for an inline/card action so it hugs its content;
   * the parent then aligns it (e.g. to the card's inline-end).
   */
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading icon, colored like the label. */
  icon?: IoniconName;
  /** Destructive action — colors the label/icon danger red (secondary/ghost). */
  destructive?: boolean;
  style?: ViewStyle;
}

/**
 * Primary / secondary / ghost full-pill button in two sizes (md CTA / sm inline),
 * with default, pressed, disabled and loading states, an optional leading icon,
 * and a destructive mode. `fullWidth={false}` makes it hug its content for
 * card-level actions. RTL-safe (symmetric padding, no physical props).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  fullWidth = true,
  disabled = false,
  loading = false,
  icon,
  destructive = false,
  style,
}: ButtonProps) {
  const v = VARIANT[variant];
  const sz = SIZE[size];
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
        { minHeight: sz.minHeight, paddingHorizontal: sz.paddingHorizontal },
        fullWidth ? null : styles.hug,
        { backgroundColor: disabled ? v.bgDisabled : pressed ? v.bgPressed : v.bg },
        v.border ? { borderWidth: 1, borderColor: v.border } : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={[styles.content, { gap: sz.gap }]}>
        {loading ? <ActivityIndicator color={color.text.inverse} /> : null}
        {icon && !loading ? <Ionicons name={icon} size={sz.iconSize} color={labelColor} /> : null}
        <Text
          variant={sz.labelVariant}
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
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hug: { alignSelf: 'flex-start' },
  content: { flexDirection: 'row', alignItems: 'center' },
  label: { textTransform: 'uppercase', letterSpacing: 0.5 },
  disabled: { opacity: 0.85 },
});
