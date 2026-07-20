import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBatches } from '../data/queries';
import { balanceByType } from '../data/wallet';
import { fetchPurchaseById } from '../lib/api';
import { queryClient, queryKeys } from '../lib/queryClient';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingView,
  Screen,
  StatusChip,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

const POLL_MS = 2000;
const TIMEOUT_MS = 40_000;

/**
 * The return journey (S6 Task 4, extended in S6.1). The user paid in a browser sheet
 * and came back. Three terminal outcomes now, not two:
 *   succeeded → the credits, read from the batch the webhook actually minted;
 *   failed    → a decline screen (no credits, no charge) — we STOP, we don't poll;
 *   pending   → "Confirming your payment…" (bounded poll), then an honest timeout.
 *
 * Two signals feed this, and we trust them differently:
 *   - the redirect `outcome` param (client-controlled, instant) decides WHICH screen
 *     to show first — a fast path that kills the infinite spinner on a decline;
 *   - the webhook-written purchase.status (server-verified, durable) is the source of
 *     truth. Credits come ONLY from the minted batch, NEVER from the redirect param.
 * So `outcome=failure` shows the decline screen with no poll; `outcome=success` (or
 * none) polls until the status resolves — and a polled `failed` still routes to the
 * decline screen, so correctness never depends on the redirect arriving.
 */
export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const { purchaseId, outcome } = useLocalSearchParams<{ purchaseId: string; outcome?: string }>();
  const knownDeclined = outcome === 'failure';
  const [deadline] = useState(() => Date.now() + TIMEOUT_MS);
  const [timedOut, setTimedOut] = useState(false);
  const batchesQ = useBatches();

  const purchaseQ = useQuery({
    queryKey: ['purchase', purchaseId],
    queryFn: () => fetchPurchaseById(purchaseId as string),
    // Don't poll a KNOWN decline — that was the bug this session fixes.
    enabled: Boolean(purchaseId) && !knownDeclined,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'succeeded' || s === 'failed' || timedOut ? false : POLL_MS;
    },
  });
  const settled = purchaseQ.data?.status === 'succeeded';
  const declined = knownDeclined || purchaseQ.data?.status === 'failed';

  // The webhook settled → the batch exists. Refresh the wallet + purchase history.
  useEffect(() => {
    if (settled) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.creditBatches });
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchases });
    }
  }, [settled]);

  // A declined purchase still belongs in purchase history — refresh it so the failed
  // row shows there (it will never masquerade as pending).
  useEffect(() => {
    if (declined) void queryClient.invalidateQueries({ queryKey: queryKeys.purchases });
  }, [declined]);

  // Stop polling at the deadline — a bounded wait, never an endless spinner.
  useEffect(() => {
    if (settled || declined || timedOut) return;
    const t = setInterval(() => {
      if (Date.now() >= deadline) setTimedOut(true);
    }, 1000);
    return () => clearInterval(t);
  }, [settled, declined, timedOut, deadline]);

  // ── declined: honest, non-alarming — no credits, no charge (a decline never captures) ──
  if (declined) {
    return (
      <Screen>
        <SuccessView
          tone="accent"
          icon="close-circle-outline"
          eyebrow="Payment declined"
          title="Payment didn't go through"
          primary={{ label: 'Try again', onPress: () => router.replace('/buy-credits') }}
          secondary={{ label: 'Done', onPress: () => router.replace('/(tabs)') }}
        >
          <Card>
            <Text variant="body" tone="secondary">
              Your payment wasn&apos;t completed, so no credits were added — and you were not
              charged. You can try again whenever you&apos;re ready.
            </Text>
          </Card>
        </SuccessView>
      </Screen>
    );
  }

  // ── settled: show the credits the webhook actually minted (batch.purchaseId === ours) ──
  const batch = settled ? (batchesQ.data ?? []).find((b) => b.purchaseId === purchaseId) : undefined;
  if (settled && batch && player) {
    const meta = TRAINING_META[batch.trainingType];
    const balance = balanceByType(batchesQ.data ?? [], now)[batch.trainingType];
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

  // ── timed out (and not settled/declined): honest, no false success ──
  if (timedOut && !settled) {
    return (
      <Screen style={styles.timeout}>
        <EmptyState
          icon="hourglass-outline"
          title="Still confirming your payment"
          message="We haven't heard back from the payment provider yet. If your card was charged, your credits will appear in your wallet within a few minutes — you won't be charged twice."
        />
        <View style={styles.buttons}>
          <Button label="Check my wallet" onPress={() => router.replace('/wallet')} />
          <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </View>
      </Screen>
    );
  }

  // ── polling (or settled but the batch is still refetching) ──
  return (
    <Screen>
      <LoadingView label="Confirming your payment…" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  title: { marginBottom: space.xs },
  expiry: { marginTop: space.sm },
  timeout: { flexGrow: 1, justifyContent: 'center', gap: space.lg },
  buttons: { gap: space.sm, paddingHorizontal: space.lg },
});
