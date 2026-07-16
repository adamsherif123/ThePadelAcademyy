import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { Purchase, PurchaseStatus } from '@tpa/types';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { packageForPurchase, playerPurchases } from '../data/purchases';
import { useDataStore } from '../data/store';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  type BadgeTone,
  Card,
  EmptyState,
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

/**
 * Purchase history (undesigned — built to the established pattern). Each purchase
 * with its status rendered distinctly; empty state when there are none.
 */
export default function PurchaseHistoryScreen() {
  const router = useRouter();
  const { player } = useSession();
  useDataStore();
  if (!player) return null;

  const purchases = playerPurchases(player.id);

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
          purchases.map((purchase) => <PurchaseRow key={purchase.id} purchase={purchase} />)
        )}
    </Screen>
  );
}

function PurchaseRow({ purchase }: { purchase: Purchase }) {
  const pkg = packageForPurchase(purchase);
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
          {formatInstantDate(purchase.createdAt)}
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
