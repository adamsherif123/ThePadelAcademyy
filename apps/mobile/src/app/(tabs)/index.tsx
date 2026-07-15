import { formatExpiry, formatPiastres, formatSessionTimeRange } from '@tpa/core';
import { MOCK_NOW, mockCreditBatches, mockPackages, mockSlots } from '@tpa/mocks';
// eslint-disable-next-line no-restricted-imports -- S0/S1 placeholder; shared <Text> arrives in S2.
import { ScrollView, StyleSheet, Text } from 'react-native';

/**
 * S1 proof screen (throwaway, default styling only): renders real data from
 * @tpa/mocks formatted through @tpa/core. Proves @tpa/types + @tpa/core +
 * @tpa/mocks all resolve and run inside Hermes. Real UI is a later session.
 */
export default function HomeScreen() {
  const featured = mockPackages.slice(0, 3);
  const upcoming = mockSlots
    .filter((s) => new Date(s.startsAt).getTime() > new Date(MOCK_NOW).getTime())
    .slice(0, 3);
  const expiringBatch = mockCreditBatches[1];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Home</Text>

      <Text style={styles.h2}>Packages</Text>
      {featured.map((p) => (
        <Text key={p.id} style={styles.row}>
          {p.name} — {formatPiastres(p.price)}
        </Text>
      ))}

      <Text style={styles.h2}>Upcoming sessions</Text>
      {upcoming.map((s) => (
        <Text key={s.id} style={styles.row}>
          {formatSessionTimeRange(s.startsAt, s.endsAt)}
        </Text>
      ))}

      {expiringBatch ? (
        <Text style={styles.note}>
          Group credits: {formatExpiry(expiringBatch.expiresAt, MOCK_NOW)}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 6 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  row: { fontSize: 15 },
  note: { fontSize: 14, marginTop: 16, fontStyle: 'italic' },
});
