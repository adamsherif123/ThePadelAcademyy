import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { CreditBatchId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { getBatches, useDataStore } from '../data/store';
import { balanceByType } from '../data/wallet';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Card,
  Screen,
  StatusChip,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

/**
 * Purchase success (undesigned — built to the shared SuccessView pattern used by
 * booked-success). Credits added, the new balance, and the expiry — all derived
 * from the granted batch (buildPurchaseCredits) and formatExpiry, never hardcoded.
 */
export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  useDataStore();
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  const batch = getBatches().find((b) => b.id === (batchId as CreditBatchId));

  if (!batch || !player) {
    return <Screen />;
  }

  const meta = TRAINING_META[batch.trainingType];
  const balance = balanceByType(player.id, now)[batch.trainingType];

  return (
    <Screen>
      <SuccessView
        tone="success"
        eyebrow="Payment confirmed"
        title="Credits added"
        primary={{ label: 'Go to Wallet', onPress: () => router.replace('/wallet') }}
        secondary={{ label: 'Done', onPress: () => router.replace('/(tabs)') }}
      >
        <Card>
          <View style={styles.head}>
            <Badge label={meta.label} icon={meta.icon} />
            <StatusChip expiresAt={batch.expiresAt} now={now} />
          </View>
          <Text variant="h2" style={styles.title}>
            {`${batch.quantityTotal} ${meta.label} credits added`}
          </Text>
          <Text variant="body" tone="secondary">
            {`New ${meta.label} balance: ${balance} credit${balance === 1 ? '' : 's'}`}
          </Text>
          <Text variant="caption" tone="muted" style={styles.expiry}>
            {`Valid until ${formatInstantDate(batch.expiresAt)}`}
          </Text>
        </Card>
      </SuccessView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  title: { marginBottom: space.xs },
  expiry: { marginTop: space.sm },
});
