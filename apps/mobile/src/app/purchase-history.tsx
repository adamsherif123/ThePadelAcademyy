import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { Package, PaymentMethod, Purchase, PurchaseStatus } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { daysBefore } from '../lib/api';
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
  SegmentedControl,
  Text,
} from '../ui';

const STATUS_META: Record<PurchaseStatus, { label: string; tone: BadgeTone }> = {
  succeeded: { label: 'Succeeded', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** How the player paid — cash at the desk, InstaPay transfer, or cards through Paymob. */
const METHOD_LABEL: Record<PaymentMethod, string> = { paymob: 'Card', cash: 'Cash', instapay: 'InstaPay' };

/**
 * How far back the list reaches. The default is deliberately NOT lifetime: a credit
 * batch expires 40 days after purchase, so three months is already well past
 * anything still spendable, and it keeps the common visit to a small bounded read.
 * "All time" is one tap away and fetches the full history only when asked for.
 */
type Range = '3m' | '12m' | 'all';
const RANGES: readonly { value: Range; label: string }[] = [
  { value: '3m', label: '3 months' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All time' },
];
const RANGE_DAYS: Record<Range, number | null> = { '3m': 90, '12m': 365, all: null };

/**
 * Purchase history (undesigned — built to the established pattern). Each purchase
 * with its status rendered distinctly; empty state when there are none.
 *
 * Server-side windowed: the screen asks for `created_at >= now - N days` rather than
 * pulling every purchase the player has ever made and filtering on the device.
 */
export default function PurchaseHistoryScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const [range, setRange] = useState<Range>('3m');
  const days = RANGE_DAYS[range];
  const purchasesQ = usePurchases(days === null ? null : daysBefore(now, days));
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

        <View style={styles.filter}>
          <SegmentedControl options={RANGES} value={range} onChange={setRange} />
        </View>

        {purchases.length === 0 ? (
          range === 'all' ? (
            <EmptyState
              icon="receipt-outline"
              title="No purchases yet"
              message="When you buy a credit bundle, it'll show up here with its status and date."
              cta={{ label: 'Buy credits', onPress: () => router.push('/buy-credits') }}
            />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="Nothing in this period"
              message={`Nothing bought in the last ${range === '3m' ? '3 months' : '12 months'}. Your older purchases are still here.`}
              cta={{ label: 'Show all time', onPress: () => setRange('all') }}
            />
          )
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
  filter: { marginBottom: space.sm },
  content: { gap: space.md },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
});
