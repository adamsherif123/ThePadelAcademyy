import { formatPiastres } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { PackageId, Piastres } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { packageById, perSessionPiastres } from '../data/catalog';
import { payForPackage } from '../data/purchases';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Button,
  Card,
  InfoCard,
  Money,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../ui';

/**
 * Checkout (undesigned — built to the established pattern). Order summary + a
 * single pay CTA. Payment is entirely mocked behind the `payForPackage` seam,
 * which S6 replaces with the real Paymob flow.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const pkg = packageById(packageId as PackageId);

  if (!pkg || !player) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Checkout" title="Not Found" onBack={() => router.back()} />
      </Screen>
    );
  }

  const meta = TRAINING_META[pkg.trainingType];
  const perSession = perSessionPiastres(pkg) as Piastres;

  const onPay = () => {
    const { batch } = payForPackage(player.id, pkg, now);
    router.replace({ pathname: '/purchase-success', params: { batchId: batch.id } });
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Checkout" title="Order Summary" onBack={() => router.back()} />

        <Card>
          <View style={styles.head}>
            <Badge label={meta.label} icon={meta.icon} />
          </View>
          <Text variant="h2" style={styles.name}>
            {pkg.name}
          </Text>

          <View style={styles.divider} />

          <Row label="Sessions" value={<Text variant="body" weight="bold">{String(pkg.sessionCount)}</Text>} />
          <Row label="Per session" value={<Money amount={perSession} variant="body" />} />

          <View style={styles.divider} />

          <View style={styles.totalRow}>
            <Text variant="label">Total</Text>
            <Money amount={pkg.price} tone="accent" variant="h1" />
          </View>
        </Card>

        <InfoCard
          variant="neutral"
          icon="lock-closed-outline"
          text="You'll be charged once. Credits load instantly after payment."
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button label={`Pay ${formatPiastres(pkg.price)}`} onPress={onPay} />
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      {value}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg },
  head: { flexDirection: 'row' },
  name: { marginTop: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
  footer: {
    padding: space.xl,
    borderTopWidth: 1,
    borderTopColor: color.border.subtle,
    backgroundColor: color.bg.canvas,
  },
});
