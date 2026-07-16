import { color, fontSize, radius, space } from '@tpa/theme';
import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { fontFamilyForWeight } from '../theme/fonts';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style' | 'editable'> {
  label?: string;
  /** Presence switches the field to its error styling and shows the message. */
  error?: string;
  disabled?: boolean;
  /** `navy` for dark auth surfaces (translucent field, light text). */
  tone?: 'light' | 'navy';
}

/**
 * Text field with default / focused / error / disabled states. Border comes from
 * tokens (strong by default, accent when focused, danger on error). `tone='navy'`
 * adapts it for dark auth screens. RTL-safe: no physical text alignment.
 */
export function Input({ label, error, disabled = false, tone = 'light', ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const isNavy = tone === 'navy';

  const borderColor = error
    ? color.status.danger
    : focused
      ? color.accent.default
      : isNavy
        ? color.border.onInverse
        : color.border.strong;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="caption" tone={isNavy ? 'inverse' : 'secondary'}>
          {label}
        </Text>
      ) : null}
      <TextInput
        {...rest}
        editable={!disabled}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={color.text.muted}
        style={[
          styles.input,
          isNavy ? styles.inputNavy : styles.inputLight,
          { borderColor },
          disabled ? styles.disabled : null,
        ]}
      />
      {error ? (
        <Text variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    fontFamily: fontFamilyForWeight.regular,
    fontSize: fontSize.body,
    // No textAlign: RN aligns to the writing direction's start by default (RTL-safe).
  },
  inputLight: { backgroundColor: color.bg.surface, color: color.text.primary },
  inputNavy: { backgroundColor: color.pillOnInverse.bg, color: color.text.inverse },
  disabled: { backgroundColor: color.bg.canvas, opacity: 0.7 },
  error: { color: color.status.danger },
});
