import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { Screen } from './Screen';

/**
 * Full-bleed deep-navy screen — the auth / onboarding surface (the app proper
 * stays on the light canvas). A thin wrapper over Screen so both share the same
 * safe-area handling (scroll content / sticky footer both clear the home
 * indicator; no dead bottom gap). RTL-safe.
 */
export function NavyScreen({
  children,
  scroll = false,
  padded = true,
  contentContainerStyle,
  footer,
  style,
}: {
  children?: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  contentContainerStyle?: ViewStyle;
  footer?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Screen
      tone="navy"
      scroll={scroll}
      padded={padded}
      contentContainerStyle={contentContainerStyle}
      footer={footer}
      style={style}
    >
      {children}
    </Screen>
  );
}
