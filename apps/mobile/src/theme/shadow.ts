import { color, elevation } from '@tpa/theme';
import type { ViewStyle } from 'react-native';

/**
 * Map a platform-agnostic elevation token to RN shadow props. iOS/web read the
 * shadow* fields; Android reads `elevation`. Shadow color is a token (ink), never
 * an inline hex.
 *
 * Deliberately NOT theme-reactive (dark mode): a shadow's job is to read as a
 * soft dark tint beneath a raised surface regardless of scheme — using the
 * ACTIVE theme's text.primary here would shadow dark-mode cards in near-white
 * (DARK_INK), which is backwards. `color` stays the static light import
 * (INK, a fixed near-black) on purpose; every dark-mode-aware color read in
 * this app goes through useTheme() instead.
 */
export function shadow(level: keyof typeof elevation): ViewStyle {
  const e = elevation[level];
  return {
    shadowColor: color.text.primary,
    shadowOffset: { width: 0, height: e.y },
    shadowRadius: e.blur,
    shadowOpacity: e.opacity,
    elevation: e.elevation,
  };
}
