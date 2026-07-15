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
}

/**
 * Text field with default / focused / error / disabled states. Border comes from
 * tokens (strong by default, accent when focused, danger on error). RTL-safe:
 * text aligns to `start`.
 */
export function Input({ label, error, disabled = false, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? color.status.danger
    : focused
      ? color.accent.default
      : color.border.strong;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="caption" tone="secondary">
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
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.bg.surface,
    color: color.text.primary,
    fontFamily: fontFamilyForWeight.regular,
    fontSize: fontSize.body,
    // No textAlign: RN aligns to the writing direction's start by default (RTL-safe).
  },
  disabled: { backgroundColor: color.bg.canvas, opacity: 0.7 },
  error: { color: color.status.danger },
});
