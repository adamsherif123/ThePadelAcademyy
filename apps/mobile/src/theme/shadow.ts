import { color, elevation } from '@tpa/theme';
import type { ViewStyle } from 'react-native';

/**
 * Map a platform-agnostic elevation token to RN shadow props. iOS/web read the
 * shadow* fields; Android reads `elevation`. Shadow color is a token (ink), never
 * an inline hex.
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
