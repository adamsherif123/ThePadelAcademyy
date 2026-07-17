import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { Package, PaymentMethod, Purchase, PurchaseStatus } from '@tpa/types';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { packageForPurchase, playerPurchases } from '../data/purchases';
import { usePackages, usePurchases, combine } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  type BadgeTone,
  Card,
  EmptyState,
  ErrorView,
  LoadingView,
  Money,
  Screen,
  ScreenHeader,
  Text,
} from '../ui';

const STATUS_META: Record<PurchaseStatus, { label: string; tone: BadgeTone }> = {
  succeeded: { label: 'Succeeded', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** How the player paid — cash sales are taken at the desk, cards through Paymob. */
const METHOD_LABEL: Record<PaymentMethod, string> = { paymob: 'Card', cash: 'Cash' };

/**
 * Purchase history (undesigned — built to the established pattern). Each purchase
 * with its status rendered distinctly; empty state when there are none.
 */
export default function PurchaseHistoryScreen() {
  const router = useRouter();
  const { player } = useSession();
  const purchasesQ = usePurchases();
  const packagesQ = usePackages();
  const gate = combine(purchasesQ, packagesQ);
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your account" title="Purchase History" onBack={() => router.back()} />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const purchases = playerPurchases(purchasesQ.data ?? []);
  const packages = packagesQ.data ?? [];

  return (
    <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your account" title="Purchase History" onBack={() => router.back()} />

        {purchases.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No purchases yet"
            message="When you buy a credit bundle, it'll show up here with its status and date."
            cta={{ label: 'Buy credits', onPress: () => router.push('/buy-credits') }}
          />
        ) : (
          purchases.map((purchase) => (
            <PurchaseRow key={purchase.id} purchase={purchase} packages={packages} />
          ))
        )}
    </Screen>
  );
}

function PurchaseRow({ purchase, packages }: { purchase: Purchase; packages: Package[] }) {
  const pkg = packageForPurchase(packages, purchase);
  const status = STATUS_META[purchase.status];
  return (
    <Card>
      <View style={styles.rowTop}>
        <Text variant="body" weight="bold">
          {pkg?.name ?? 'Package'}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <View style={styles.rowBottom}>
        <Text variant="caption" tone="secondary">
          {formatInstantDate(purchase.createdAt)} · {METHOD_LABEL[purchase.paymentMethod]}
        </Text>
        <Money amount={purchase.amount} variant="body" weight="bold" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
});
