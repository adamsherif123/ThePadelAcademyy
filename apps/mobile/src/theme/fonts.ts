import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from '@expo-google-fonts/inter';
import type { FontWeightToken } from '@tpa/theme';

/**
 * Fonts. The live site loads no custom face (system-ui stack); Inter is the
 * closest Expo-compatible equivalent — it was designed as a system-ui
 * replacement, so it preserves the site's neutral look. One family, six weights.
 *
 * THE ANDROID GLYPH TRAP: passing both `fontFamily` (weight baked into the file,
 * e.g. Inter_700Bold) AND `fontWeight` makes Android synthesize/clsip glyphs.
 * Defence in depth:
 *   1) The shared <Text> selects a weight token, resolves it here to a baked
 *      family, and sets ONLY `fontFamily` — it never writes `fontWeight`.
 *   2) An ESLint rule bans the `fontWeight` property across apps/mobile.
 */

/** Passed to expo-font's useFonts() to load the faces at startup. */
export const interFonts = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
};

/**
 * Weight token (from @tpa/theme) → the baked Inter family that already carries
 * that weight. `satisfies Record<FontWeightToken, ...>` keeps it exhaustive: add
 * a weight token to the theme and this stops compiling until a family is mapped.
 * This is the value <Text> assigns to `fontFamily`; nothing else may set weight.
 */
export const fontFamilyForWeight = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
  black: 'Inter_900Black',
} as const satisfies Record<FontWeightToken, string>;
