import { creditExpiryState, formatExpiry } from '@tpa/core';
import { creditExpiry, radius, space } from '@tpa/theme';
import type { IsoInstant } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

/** Capitalize the first letter of core's (lowercase) expiry copy for display. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The wallet expiry chip. Color is driven entirely by expiry state (green ok /
 * amber expiring_soon / red expired) from creditExpiry tokens; the copy comes
 * from @tpa/core's formatExpiry — never hand-written. RTL-safe.
 */
export function StatusChip({ expiresAt, now }: { expiresAt: IsoInstant; now: IsoInstant }) {
  const state = creditExpiryState(expiresAt, now);
  const c = creditExpiry[state];
  return (
    <View style={[styles.base, { backgroundColor: c.bg }]}>
      <Text variant="caption" weight="bold" style={{ color: c.fg }}>
        {capitalize(formatExpiry(expiresAt, now))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
});
