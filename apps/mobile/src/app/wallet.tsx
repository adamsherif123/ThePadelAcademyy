import { CREDIT_EXPIRY_DAYS, formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { CreditBatch } from '@tpa/types';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useDataStore } from '../data/store';
import { activeBatches, balanceByType, expiredBatches, totalReadyToBook } from '../data/wallet';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Card,
  CreditsSummaryCard,
  ProgressBar,
  Screen,
  ScreenHeader,
  StatusChip,
  Text,
  TRAINING_META,
} from '../ui';

function batchName(b: CreditBatch): string {
  if (b.source === 'signup_grant') return 'Welcome Trial Credits';
  return `${TRAINING_META[b.trainingType].label} ${b.quantityTotal}-Pack`;
}

function batchOrigin(b: CreditBatch): string {
  const date = formatInstantDate(b.createdAt);
  return b.source === 'signup_grant' ? `Free at signup · ${date}` : `Purchased · ${date}`;
}

export default function WalletScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  useDataStore(); // re-render when a purchase grants credits
  if (!player) return null;

  const total = totalReadyToBook(player.id, now);
  const balance = balanceByType(player.id, now);
  const active = activeBatches(player.id, now);
  const expired = expiredBatches(player.id, now);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Wallet" title="Your Credits" onBack={() => router.back()} />

        <CreditsSummaryCard
          total={total}
          balance={balance}
          caption={'credits ready\nto book now'}
          action={{ label: 'Buy credits', icon: 'add', onPress: () => router.push('/buy-credits') }}
        />

        {/* Active batches */}
        <Text variant="label">Active batches</Text>
        {active.map((b) => (
          <BatchCard key={b.id} batch={b} now={now} />
        ))}

        {/* Expired */}
        {expired.length > 0 ? (
          <>
            <Text variant="label" tone="muted">
              Expired
            </Text>
            {expired.map((b) => (
              <BatchCard key={b.id} batch={b} now={now} expired />
            ))}
          </>
        ) : null}

        <Text variant="caption" tone="muted" style={styles.footer}>
          {`Credits are typed — a Group credit books Group sessions only. Every batch expires ${CREDIT_EXPIRY_DAYS} days after purchase.`}
      </Text>
    </Screen>
  );
}

function BatchCard({
  batch,
  now,
  expired = false,
}: {
  batch: CreditBatch;
  now: CreditBatch['expiresAt'];
  expired?: boolean;
}) {
  const meta = TRAINING_META[batch.trainingType];
  const fraction = batch.quantityTotal === 0 ? 0 : batch.quantityRemaining / batch.quantityTotal;

  return (
    <Card style={expired ? styles.expiredCard : undefined}>
      <View style={styles.batchHead}>
        <Badge label={meta.label} icon={meta.icon} />
        <StatusChip expiresAt={batch.expiresAt} now={now} />
      </View>

      <View style={styles.batchBody}>
        <View style={styles.batchInfo}>
          <Text variant="body" weight="bold" style={styles.batchName}>
            {batchName(batch)}
          </Text>
          <Text variant="caption" tone="muted">
            {batchOrigin(batch)}
          </Text>
        </View>
        <View style={styles.fraction}>
          <Text variant="h1" tone={expired ? 'muted' : 'primary'}>
            {String(batch.quantityRemaining)}
          </Text>
          <Text variant="body" tone="muted">
            {`/${batch.quantityTotal}`}
          </Text>
        </View>
      </View>

      <ProgressBar value={fraction} tone={expired ? 'muted' : 'accent'} />

      <Text variant="caption" tone="secondary" style={styles.batchFoot}>
        {expired
          ? `${batch.quantityRemaining} credit${batch.quantityRemaining === 1 ? '' : 's'} lost to expiry`
          : `${batch.quantityRemaining} of ${batch.quantityTotal} sessions left to book`}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  batchHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  batchBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space.sm },
  batchInfo: { flex: 1, gap: 2 },
  batchName: { textTransform: 'uppercase', letterSpacing: 0.3 },
  fraction: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  batchFoot: { marginTop: space.sm },
  expiredCard: { opacity: 0.7 },
  footer: { marginTop: space.md, textAlign: 'center' },
});
