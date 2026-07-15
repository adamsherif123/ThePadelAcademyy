import { formatSessionTimeRange } from '@tpa/core';
import { MOCK_NOW, mockCreditBatches, mockPackages, mockSlots } from '@tpa/mocks';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { CreditPill } from '../../ui/CreditPill';
import { Money } from '../../ui/Money';
import { Text } from '../../ui/Text';

/**
 * S2 Home — still not a product screen, but now rendered entirely through the
 * design system (shared <Text>, Card, Money, CreditPill) against @tpa/mocks. The
 * real Home lands in a later session.
 */
export default function HomeScreen() {
  const router = useRouter();
  const featured = mockPackages.slice(0, 3);
  const upcoming = mockSlots
    .filter((s) => new Date(s.startsAt).getTime() > new Date(MOCK_NOW).getTime())
    .slice(0, 3);
  const wallet = mockCreditBatches.slice(0, 3);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text variant="display">The Padel Academy</Text>

      <Text variant="label">Packages</Text>
      {featured.map((p) => (
        <Card key={p.id}>
          <Text variant="h2">{p.name}</Text>
          <Money amount={p.price} tone="accent" variant="h2" />
        </Card>
      ))}

      <Text variant="label">Upcoming sessions</Text>
      {upcoming.map((s) => (
        <Text key={s.id} variant="body">
          {formatSessionTimeRange(s.startsAt, s.endsAt)}
        </Text>
      ))}

      <Text variant="label">Wallet</Text>
      <View style={styles.wallet}>
        {wallet.map((b) => (
          <CreditPill key={b.id} batch={b} now={MOCK_NOW} />
        ))}
      </View>

      <Button label="Dev · Component gallery" variant="secondary" onPress={() => router.push('/gallery')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg },
  wallet: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
