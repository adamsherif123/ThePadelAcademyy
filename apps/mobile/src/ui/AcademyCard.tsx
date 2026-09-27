import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { space } from '@tpa/theme';

import { useLocation } from '../location/LocationProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ACADEMY } from './academy';
import { Card } from './Card';
import { IconRow } from './IconRow';


/**
 * The "THE ACADEMY" card on Home and Profile — now the SELECTED branch.
 *
 * It follows the toggle rather than a session, because this card is not about any
 * one booking: it answers "where am I looking at, and when is it open". The hours
 * come from that branch's own hours_text, so two branches with different opening
 * times each tell the truth.
 *
 * Falls back to the ACADEMY constant before locations load, and in the coach
 * shell, which has no LocationProvider above it — the original club's details are
 * the right guess when there is nothing better.
 */
export function AcademyCard() {
  const { color } = useTheme();
  const { selected } = useLocation();
  const name = selected?.name ?? ACADEMY.name;
  const address = selected?.address ?? ACADEMY.address;
  const mapsUrl = selected?.mapsUrl ?? ACADEMY.mapsUrl;
  const hours = selected?.hoursText ?? ACADEMY.hours;
  const styles = useMemo(
    () => StyleSheet.create({
      divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
    }),
    [color],
  );
  return (
    <Card>
      {/* Taps through to Maps — same pattern as the booking card's location row. */}
      <Pressable
        onPress={() => Linking.openURL(mapsUrl)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name} in Maps`}
      >
        <IconRow icon="location-outline" title={name} subtitle={address} />
      </Pressable>
      <View style={styles.divider} />
      <IconRow icon="time-outline" title={hours} />
    </Card>
  );
}
