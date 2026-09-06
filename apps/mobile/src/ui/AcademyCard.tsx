import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { space } from '@tpa/theme';

import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { IconRow } from './IconRow';

/** The academy's real location + hours. Brand facts, not mock data. */
export const ACADEMY = {
  name: 'Oro Plaza Hotel',
  address: 'In front of Family Park, Rehab, Cairo',
  /** The canonical one-line location shown on session cards — the ONE source. */
  locationLine: 'Oro Plaza Hotel · Rehab, Cairo',
  /** Deep link to Maps — the location line taps through here before a session. */
  mapsUrl: 'https://maps.google.com/?q=Oro+Plaza+Hotel+Rehab+Cairo',
  hours: 'Sun – Wed · 5:00 PM – 11:00 PM',
  hoursNote: 'Group training mainly 5 – 9 PM',
  /**
   * The two people who answer for the academy (Profile → Contact us). Kept here with
   * the rest of the brand facts so there's ONE place to change a number, rather than
   * a screen holding its own copy.
   *
   * `display` is how the number is read locally; `e164` is what tel: and wa.me need.
   * (Aly's number is also the InstaPay destination in request-credits — deliberately
   * NOT shared with this list: one is a payment address, the other a contact, and
   * they're free to diverge.)
   */
  contacts: [
    { name: 'Aly Salem', display: '01003487025', e164: '+201003487025' },
    { name: 'Mohamed Elgaby', display: '01010083464', e164: '+201010083464' },
  ],
} as const;

/** The "THE ACADEMY" card shown on Home and Profile. */
export function AcademyCard() {
  const { color } = useTheme();
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
        onPress={() => Linking.openURL(ACADEMY.mapsUrl)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${ACADEMY.name} in Maps`}
      >
        <IconRow icon="location-outline" title={ACADEMY.name} subtitle={ACADEMY.address} />
      </Pressable>
      <View style={styles.divider} />
      <IconRow icon="time-outline" title={ACADEMY.hours} subtitle={ACADEMY.hoursNote} />
    </Card>
  );
}
