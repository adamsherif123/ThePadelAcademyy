import {
  colorSchemes,
  creditExpirySchemes,
  elevation,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  space,
  type ColorScheme,
} from '@tpa/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';

/** What the user picked. 'system' (the default) follows the OS; the other two force a scheme regardless of it. */
export type ThemePreference = 'system' | ColorScheme;

// The first direct AsyncStorage read/write in this app outside the Supabase
// client's own storage adapter (lib/supabase.ts) — same persistence mechanism,
// its own key.
const STORAGE_KEY = 'tpa.themePreference';

export interface ThemeValue {
  color: (typeof colorSchemes)[ColorScheme];
  creditExpiry: (typeof creditExpirySchemes)[ColorScheme];
  space: typeof space;
  radius: typeof radius;
  elevation: typeof elevation;
  fontSize: typeof fontSize;
  lineHeight: typeof lineHeight;
  letterSpacing: typeof letterSpacing;
  fontWeight: typeof fontWeight;
  /** The scheme actually rendered right now — 'system' already resolved against the OS setting. */
  scheme: ColorScheme;
  /** What the user picked (System/Light/Dark), persisted. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Resolves the active color scheme and exposes the full token set (color +
 * creditExpiry swapped per scheme; everything else — space/radius/etc — is
 * scheme-independent and passed through unchanged) through `useTheme()`.
 *
 * 'system' (the default, and the only state on first launch before
 * AsyncStorage resolves) follows `useColorScheme()`, which itself follows
 * app.json's `userInterfaceStyle: "automatic"`. A user can force Light or Dark
 * regardless of the OS via the profile screen's toggle; that choice persists
 * across launches.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const deviceScheme = useDeviceColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Load the persisted preference once, at startup. No stored value (first
  // launch, or a cleared app) leaves the 'system' default untouched.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // No persisted preference is recoverable — 'system' stays the default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  // useColorScheme() can also report 'unspecified' (some Android versions) or
  // null (briefly, before native reports it) — anything but an explicit 'dark'
  // resolves to 'light', the same safe default the app always had.
  const scheme: ColorScheme = preference === 'system' ? (deviceScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeValue>(
    () => ({
      color: colorSchemes[scheme],
      creditExpiry: creditExpirySchemes[scheme],
      space,
      radius,
      elevation,
      fontSize,
      lineHeight,
      letterSpacing,
      // this is @tpa/theme's fontWeight TOKEN SCALE (semantic weight name -> numeric
      // value), passed through unchanged; never a React Native style prop, so the
      // Android glyph-clipping trap this rule guards against doesn't apply here.
      // eslint-disable-next-line no-restricted-syntax
      fontWeight,
      scheme,
      preference,
      setPreference,
    }),
    [scheme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active, scheme-resolved token set. Must be called under `ThemeProvider` (mounted once, at the app root). */
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
