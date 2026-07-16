import type { FontWeightToken } from '@tpa/theme';

/**
 * Fonts. The live site loads no custom face (system-ui stack); Inter is the
 * closest Expo-compatible equivalent — it was designed as a system-ui
 * replacement, so it preserves the site's neutral look. One family, five weights
 * (regular…extrabold; the app renders nothing at 900, so black isn't loaded).
 *
 * WHY DIRECT .ttf REQUIRES, NOT the `@expo-google-fonts/inter` barrel: that index
 * `require`s EVERY Inter face (100–900 + italics, ~36 files), so importing any
 * name from it bundles the whole family regardless of what's referenced. Requiring
 * the five faces we use directly is the only way to keep the unused weights —
 * black included — out of the Hermes bundle. `useFonts` is imported from
 * `expo-font` (where the barrel re-exports it from) for the same reason.
 *
 * THE ANDROID GLYPH TRAP: passing both `fontFamily` (weight baked into the file,
 * e.g. Inter_700Bold) AND `fontWeight` makes Android synthesize/clip glyphs.
 * Defence in depth:
 *   1) The shared <Text> selects a weight token, resolves it here to a baked
 *      family, and sets ONLY `fontFamily` — it never writes `fontWeight`.
 *   2) An ESLint rule bans the `fontWeight` property across apps/mobile.
 */

/**
 * Passed to expo-font's useFonts() to load the faces at startup. Keys are the
 * family names <Text> sets as `fontFamily`; values are the required .ttf assets.
 */
export const interFonts = {
  Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  Inter_800ExtraBold: require('@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf'),
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
} as const satisfies Record<FontWeightToken, string>;
