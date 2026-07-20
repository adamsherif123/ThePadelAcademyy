import { formatPiastres } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { PackageId, Piastres } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { packageById, perSessionPiastres } from '../data/catalog';
import { usePackages } from '../data/queries';
import { payForPackage } from '../data/payments';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Button,
  Card,
  ErrorView,
  InfoCard,
  LoadingView,
  Money,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../ui';

/**
 * Checkout. Order summary + a single pay CTA. `payForPackage` (S6) inserts a PENDING
 * purchase, gets a Paymob checkout URL, and opens the browser; on return we route to
 * purchase-success, which POLLS until the webhook settles it — credits are minted
 * server-side, never here. The seam's promise (route to purchase-success regardless)
 * is kept.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const { player } = useSession();
  const packagesQ = usePackages();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { packageId } = useLocalSearchParams<{ packageId: string }>();

  if (packagesQ.isPending || packagesQ.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Checkout" title="Order Summary" onBack={() => router.back()} />
        {packagesQ.isPending ? <LoadingView /> : <ErrorView onRetry={packagesQ.refetch} />}
      </Screen>
    );
  }

  const pkg = packageById(packagesQ.data ?? [], packageId as PackageId);

  if (!pkg || !player) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Checkout" title="Not Found" onBack={() => router.back()} />
      </Screen>
    );
  }

  const meta = TRAINING_META[pkg.trainingType];
  const perSession = perSessionPiastres(pkg) as Piastres;

  const onPay = async () => {
    if (paying) return;
    setPaying(true);
    setError(null);
    const res = await payForPackage(player, pkg);
    if (res.ok) {
      // Route to the return screen with the fast-path outcome hint. It confirms via
      // the server (succeeded → credits, failed → decline) and never trusts this hint
      // for anything but which screen to show first. We NEVER claim success here.
      router.replace({
        pathname: '/purchase-success',
        params: { purchaseId: res.purchaseId, outcome: res.outcome },
      });
    } else {
      setPaying(false);
      setError(res.error);
    }
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <Button
          label={paying ? 'Processing…' : `Pay ${formatPiastres(pkg.price)}`}
          onPress={onPay}
          disabled={paying}
        />
      }
    >
      <ScreenHeader eyebrow="Checkout" title="Order Summary" onBack={() => router.back()} />

      {error ? <InfoCard variant="amber" icon="alert-circle-outline" text={error} /> : null}

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
  content: { gap: space.lg },
  head: { flexDirection: 'row' },
  name: { marginTop: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
});
