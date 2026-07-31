import Ionicons from '@expo/vector-icons/Ionicons';
import { fontSize, radius, space } from '@tpa/theme';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { fontFamilyForWeight } from '../theme/fonts';
import { useTheme } from '../theme/ThemeProvider';
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
 *
 * `secureTextEntry` fields (passwords) get a show/hide eye toggle on the trailing
 * edge — masked by default, tap to reveal. Every password field in the app goes
 * through this one component, so the toggle needs wiring here only.
 */
export function Input({ label, error, disabled = false, tone = 'light', secureTextEntry, ...rest }: InputProps) {
  const { color, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isNavy = tone === 'navy';
  const isPassword = Boolean(secureTextEntry);
  const iconColor = isNavy ? color.text.inverse : color.text.muted;

  const borderColor = error
    ? color.status.danger
    : focused
      ? color.accent.default
      : isNavy
        ? color.border.onInverse
        : color.border.strong;

  const styles = useMemo(
    () => StyleSheet.create({
      wrap: { gap: space.xs },
      inputRow: { justifyContent: 'center' },
      input: {
        minHeight: 54,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: space.lg,
        fontFamily: fontFamilyForWeight.regular,
        fontSize: fontSize.body,
        // No textAlign: RN aligns to the writing direction's start by default (RTL-safe).
      },
      inputWithIcon: { paddingEnd: 48 },
      inputLight: { backgroundColor: color.bg.surface, color: color.text.primary },
      inputNavy: { backgroundColor: color.pillOnInverse.bg, color: color.text.inverse },
      disabled: { backgroundColor: color.bg.canvas, opacity: 0.7 },
      error: { color: color.status.danger },
      eyeButton: {
        position: 'absolute',
        end: 0,
        height: '100%',
        paddingHorizontal: space.md,
        alignItems: 'center',
        justifyContent: 'center',
      },
    }),
    [color],
  );

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="caption" tone={isNavy ? 'inverse' : 'secondary'}>
          {label}
        </Text>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          {...rest}
          keyboardAppearance={scheme}
          secureTextEntry={isPassword && !revealed}
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
            isPassword ? styles.inputWithIcon : null,
          ]}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={styles.eyeButton}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={iconColor} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
