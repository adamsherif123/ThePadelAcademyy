import { StyleSheet, View } from 'react-native';
import { color, space } from '@tpa/theme';

import { Card } from './Card';
import { IconRow } from './IconRow';

/** The academy's real location + hours. Brand facts, not mock data. */
export const ACADEMY = {
  name: 'Oro Plaza Hotel',
  address: 'In front of Family Park, Rehab, Cairo',
  hours: 'Sun – Wed · 5:00 PM – 11:00 PM',
  hoursNote: 'Group training mainly 5 – 9 PM',
} as const;

/** The "THE ACADEMY" card shown on Home and Profile. */
export function AcademyCard() {
  return (
    <Card>
      <IconRow icon="location-outline" title={ACADEMY.name} subtitle={ACADEMY.address} />
      <View style={styles.divider} />
      <IconRow icon="time-outline" title={ACADEMY.hours} subtitle={ACADEMY.hoursNote} />
    </Card>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
});
