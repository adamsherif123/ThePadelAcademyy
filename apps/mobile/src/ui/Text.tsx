import { color, fontSize, letterSpacing, lineHeight, type FontWeightToken } from '@tpa/theme';
// eslint-disable-next-line no-restricted-imports -- THE one sanctioned react-native Text import: this is the shared wrapper every other file must use instead.
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { fontFamilyForWeight } from '../theme/fonts';

/**
 * The shared <Text>. Every piece of text in the app renders through this — raw
 * <Text> from react-native is banned by lint everywhere else. Variants encode the
 * brand's type ramp; colors come only from tokens (via the `tone` prop). Weight
 * is resolved to a baked Inter family and set as `fontFamily`; `fontWeight` is
 * never written (Android glyph trap), and lint bans it app-wide as a backstop.
 */
export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'body'
  | 'bodySecondary'
  | 'label'
  | 'caption'
  | 'micro';

export type TextTone = 'primary' | 'secondary' | 'muted' | 'inverse' | 'label' | 'accent';

const toneColor: Record<TextTone, string> = {
  primary: color.text.primary,
  secondary: color.text.secondary,
  muted: color.text.muted,
  inverse: color.text.inverse,
  label: color.text.label,
  accent: color.accent.default,
};

interface VariantSpec {
  size: number;
  lineHeight: number;
  letterSpacing: number;
  family: string;
  uppercase?: boolean;
  defaultTone: TextTone;
}

const VARIANTS: Record<TextVariant, VariantSpec> = {
  // display/label were black(900) on the site; the app design reads extrabold(800).
  display: { size: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, family: fontFamilyForWeight.extrabold, uppercase: true, defaultTone: 'primary' },
  h1: { size: fontSize.h1, lineHeight: lineHeight.h1, letterSpacing: letterSpacing.tight, family: fontFamilyForWeight.bold, defaultTone: 'primary' },
  h2: { size: fontSize.h2, lineHeight: lineHeight.h2, letterSpacing: letterSpacing.normal, family: fontFamilyForWeight.bold, defaultTone: 'primary' },
  body: { size: fontSize.body, lineHeight: lineHeight.body, letterSpacing: letterSpacing.normal, family: fontFamilyForWeight.regular, defaultTone: 'primary' },
  bodySecondary: { size: fontSize.body, lineHeight: lineHeight.body, letterSpacing: letterSpacing.normal, family: fontFamilyForWeight.regular, defaultTone: 'secondary' },
  label: { size: fontSize.label, lineHeight: lineHeight.label, letterSpacing: letterSpacing.label, family: fontFamilyForWeight.extrabold, uppercase: true, defaultTone: 'label' },
  caption: { size: fontSize.caption, lineHeight: lineHeight.caption, letterSpacing: letterSpacing.normal, family: fontFamilyForWeight.medium, defaultTone: 'muted' },
  micro: { size: fontSize.micro, lineHeight: lineHeight.micro, letterSpacing: letterSpacing.label, family: fontFamilyForWeight.bold, uppercase: true, defaultTone: 'muted' },
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Overrides the variant's default token color. Colors are token-only. */
  tone?: TextTone;
  /** Overrides the variant's baked font family (still never emits fontWeight). */
  weight?: FontWeightToken;
}

export function Text({ variant = 'body', tone, weight, style, ...rest }: TextProps) {
  const spec = VARIANTS[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: weight ? fontFamilyForWeight[weight] : spec.family,
          fontSize: spec.size,
          lineHeight: spec.lineHeight,
          letterSpacing: spec.letterSpacing,
          color: toneColor[tone ?? spec.defaultTone],
          ...(spec.uppercase ? { textTransform: 'uppercase' as const } : null),
        },
        style,
      ]}
    />
  );
}
