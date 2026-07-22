import { CREDIT_EXPIRY_DAYS, formatInstantDate } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { CreditBatch, CreditRequest, Package } from '@tpa/types';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { packageById } from '../data/catalog';
import { useBatches, useMyCreditRequests, usePackages, useTrialEligible } from '../data/queries';
import { activeBatches, balanceByType, expiredBatches, totalReadyToBook } from '../data/wallet';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  BalancePills,
  Button,
  Card,
  CreditsSummaryCard,
  ErrorView,
  LoadingView,
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
  const batchesQ = useBatches();
  const requestsQ = useMyCreditRequests();
  const packagesQ = usePackages();
  const trialEligibleQ = useTrialEligible();
  if (!player) return null;

  if (batchesQ.isPending || batchesQ.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Wallet" title="Your Credits" onBack={() => router.back()} />
        {batchesQ.isPending ? <LoadingView /> : <ErrorView onRetry={batchesQ.refetch} />}
      </Screen>
    );
  }

  const batches = batchesQ.data ?? [];
  const total = totalReadyToBook(batches, now);
  const balance = balanceByType(batches, now);
  const active = activeBatches(batches, now);
  const expired = expiredBatches(batches, now);

  // Surface the player's latest OPEN credit request here (the wallet is where credits
  // appear, so "credits on the way / your last request was declined" belongs here — a
  // pending request isn't a purchase yet, so purchase-history isn't the place). Newest
  // first: a pending one (awaiting confirmation) or, if the most recent was rejected, the
  // reason + a way to try again. Approved requests need no card — the credits are already
  // in the batches below.
  const requests = requestsQ.data ?? [];
  const packages = packagesQ.data ?? [];
  const openRequest =
    requests.find((r) => r.status === 'pending') ??
    (requests[0]?.status === 'rejected' ? requests[0] : undefined);

  // Zero-credit empty state (A5: new players start empty). Nudge them at the once-per-player
  // trial while they're still eligible and one exists, otherwise the store. Suppressed when a
  // request is already pending — the pending card above already says "credits on the way".
  const canGetTrial =
    Boolean(trialEligibleQ.data) && packages.some((p) => p.trainingType === 'trial' && p.isActive);
  const showEmpty = active.length === 0 && openRequest?.status !== 'pending';

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Wallet" title="Your Credits" onBack={() => router.back()} />

        <CreditsSummaryCard
          total={total}
          caption={'credits ready\nto book now'}
          action={{ label: 'Buy credits', icon: 'add', onPress: () => router.push('/buy-credits') }}
        >
          <BalancePills balance={balance} />
        </CreditsSummaryCard>

        {openRequest ? (
          <RequestStatusCard
            request={openRequest}
            pkg={packageById(packages, openRequest.packageId)}
            onAgain={() => router.push('/buy-credits')}
          />
        ) : null}

        {/* Active batches — or the zero-credit nudge for a player who has none yet */}
        {showEmpty ? (
          <Card style={styles.emptyCard}>
            <Text variant="body" weight="bold">
              No credits yet
            </Text>
            <Text variant="caption" tone="secondary">
              {canGetTrial
                ? 'Start with a one-time discounted trial session, then book your first class on court.'
                : 'Buy a credit package to book your first session — a credit is what reserves your spot.'}
            </Text>
            <Button
              label={canGetTrial ? 'Get your trial session' : 'Browse packages'}
              onPress={() => router.push('/buy-credits')}
            />
          </Card>
        ) : (
          <>
            <Text variant="label">Active batches</Text>
            {active.map((b) => (
              <BatchCard key={b.id} batch={b} now={now} />
            ))}
          </>
        )}

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

function RequestStatusCard({
  request,
  pkg,
  onAgain,
}: {
  request: CreditRequest;
  pkg: Package | undefined;
  onAgain: () => void;
}) {
  const rejected = request.status === 'rejected';
  const what = pkg ? `${TRAINING_META[pkg.trainingType].label} ${pkg.sessionCount}-pack` : 'credit request';
  return (
    <Card style={rejected ? styles.rejectedCard : styles.pendingCard}>
      <View style={styles.reqHead}>
        <Badge label={rejected ? 'Declined' : 'Pending'} tone={rejected ? 'danger' : 'warning'} />
        <Text variant="caption" tone="muted">
          {formatInstantDate(request.createdAt)}
        </Text>
      </View>
      <Text variant="body" weight="bold" style={styles.reqTitle}>
        {rejected ? `Your ${what} request was declined` : `${what} — awaiting confirmation`}
      </Text>
      <Text variant="caption" tone="secondary">
        {rejected
          ? request.rejectReason
            ? `Reason: ${request.rejectReason}`
            : 'The academy declined this request.'
          : 'The academy will add your credits once they confirm your payment. You’ll get a notification.'}
      </Text>
      {rejected ? (
        <Button variant="ghost" label="Request again" onPress={onAgain} />
      ) : null}
    </Card>
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
  emptyCard: { gap: space.sm, alignItems: 'flex-start' },
  pendingCard: { gap: space.sm, borderLeftWidth: 3, borderLeftColor: color.status.warning },
  rejectedCard: { gap: space.sm, borderLeftWidth: 3, borderLeftColor: color.status.danger },
  reqHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reqTitle: { marginTop: 2 },
  batchHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  batchBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: space.sm },
  batchInfo: { flex: 1, gap: 2 },
  batchName: { textTransform: 'uppercase', letterSpacing: 0.3 },
  fraction: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  batchFoot: { marginTop: space.sm },
  expiredCard: { opacity: 0.7 },
  footer: { marginTop: space.md, textAlign: 'center' },
});
