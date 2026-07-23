import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import type { PackageId } from '@tpa/types';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { packageById } from '../data/catalog';
import { usePackages } from '../data/queries';
import { requestCreditsRpc, uploadProof, type RequestCreditsReason } from '../lib/api';
import { resetTo, resetToTab } from '../lib/nav';
import { queryClient, queryKeys } from '../lib/queryClient';
import { useSession } from '../session/SessionProvider';
import {
  Button,
  Card,
  ErrorView,
  InfoCard,
  LoadingView,
  Money,
  PillOnNavy,
  Screen,
  ScreenHeader,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

type Method = 'instapay' | 'cash';

const METHODS: { key: Method; label: string }[] = [
  { key: 'instapay', label: 'InstaPay' },
  { key: 'cash', label: 'Cash' },
];

// Copy reflects reality: the player has ALREADY paid and is REPORTING it — not paying now.
const METHOD_BLURB: Record<Method, string> = {
  instapay:
    "Transfer the amount to the academy's InstaPay number below, then submit this request with a screenshot of your transfer.",
  cash: "Pay in cash at the academy's front desk. Submit this request and we'll confirm once it's received.",
};

// The academy's live InstaPay destination. This is a MOBILE NUMBER you transfer to on
// InstaPay — NOT a bank account and NOT an IPA (@handle). It is shown in full and made
// copyable so a player never retypes it (and never sends money to a stranger).
const INSTAPAY_PHONE = '+201003487025';
// The registered account name, shown so the player can confirm the payee before sending.
const INSTAPAY_PAYEE_NAME: string | null = 'Aly Hisham Salem';

const REASON_COPY: Partial<Record<RequestCreditsReason, string>> = {
  package_inactive: 'This package is no longer available.',
  package_missing: 'This package is no longer available.',
  trial_already_used: 'You’ve already used your one-time trial session.',
};

export default function RequestCreditsScreen() {
  const router = useRouter();
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const { player } = useSession();
  const packagesQ = usePackages();

  const [method, setMethod] = useState<Method>('instapay');
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'submitted' | 'already_pending' | null>(null);
  const [copied, setCopied] = useState(false);

  const onCopyInstapay = async () => {
    await Clipboard.setStringAsync(INSTAPAY_PHONE);
    setCopied(true);
  };

  if (packagesQ.isPending || packagesQ.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Add credits" title="Request Credits" onBack={() => router.back()} />
        {packagesQ.isPending ? <LoadingView /> : <ErrorView onRetry={packagesQ.refetch} />}
      </Screen>
    );
  }

  const pkg = packageById(packagesQ.data ?? [], packageId as PackageId);
  if (!pkg || !player) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Add credits" title="Not Found" onBack={() => router.back()} />
        <Text variant="body" tone="secondary">
          This package is no longer available.
        </Text>
      </Screen>
    );
  }

  const meta = TRAINING_META[pkg.trainingType];

  // ── Optional proof: pick a screenshot and upload it to the player's own folder. A
  // failure NEVER blocks the request (proof is optional — the A4/S9.2 rule).
  const onAddProof = async () => {
    if (uploading) return;
    setUploadNote(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setUploadNote('Allow photo access to attach a screenshot — or submit without one.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const key = await uploadProof(player.id, asset.uri, asset.mimeType);
      setProofPath(key);
      setUploadNote(null);
    } catch {
      setProofPath(null);
      setUploadNote("Couldn't attach the screenshot — you can still submit without it.");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    if (submitting || uploading) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await requestCreditsRpc(pkg.id, method, proofPath);
      if (res.ok) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.creditRequests });
        setOutcome('submitted');
        return;
      }
      if (res.reason === 'already_pending') {
        setOutcome('already_pending');
        return;
      }
      setError(REASON_COPY[res.reason] ?? 'We couldn’t submit your request. Please try again.');
    } catch {
      // Transport failure/timeout (callRpc throws): the submit may or may not have landed.
      // We never leave the money path silent — tell the player where to look. A retry is
      // SAFE: the one-pending-per-player unique index dedupes it to `already_pending`, so
      // they can never create two requests or be double-charged.
      setError('We couldn’t confirm your request went through. Check your wallet — if it isn’t there, try again.');
    } finally {
      // Reset on EVERY path (the S9.2 stuck-spinner contract).
      setSubmitting(false);
    }
  };

  // ── Terminal states: submitted, or already-have-one-pending. These END the flow, so the
  // CTAs RESET the stack (a clean back path), never push onto the dead request flow.
  if (outcome) {
    const pending = outcome === 'already_pending';
    return (
      <Screen>
        <SuccessView
          icon={pending ? 'time-outline' : 'checkmark'}
          tone={pending ? 'accent' : 'success'}
          eyebrow={pending ? 'Request pending' : 'Request submitted'}
          title={pending ? 'You already have a request pending' : 'Thanks — request submitted'}
          primary={{ label: 'Go to wallet', onPress: () => resetTo('/wallet') }}
          secondary={{ label: 'Go home', onPress: () => resetToTab('/(tabs)') }}
        >
          <Card>
            <Text variant="body" tone="secondary">
              {pending
                ? 'You have a credit request awaiting the academy’s confirmation. Track it in your wallet.'
                : 'Your credits will be added once the academy confirms your payment — this isn’t instant. You’ll get a notification, and you can track the status in your wallet.'}
            </Text>
          </Card>
        </SuccessView>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <Button
          label={submitting ? 'Submitting…' : 'Submit request'}
          onPress={onSubmit}
          disabled={submitting || uploading}
        />
      }
    >
      <ScreenHeader eyebrow="Add credits" title="Request Credits" onBack={() => router.back()} />

      {/* What they're requesting */}
      <Card variant="inverse">
        <PillOnNavy label={meta.label} icon={meta.icon} />
        <Text variant="h2" tone="inverse" style={styles.gap}>
          {`${pkg.sessionCount} ${meta.label} sessions`}
        </Text>
        <View style={styles.priceRow}>
          <Money amount={pkg.price} tone="inverse" variant="h1" />
        </View>
      </Card>

      <InfoCard
        variant="amber"
        text="You're reporting a payment you've already made. Credits are added after the academy confirms it — not instantly."
      />

      {/* Payment method */}
      <View style={styles.field}>
        <Text variant="label">How did you pay?</Text>
        <View style={styles.methodRow}>
          {METHODS.map((m) => {
            const selected = method === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMethod(m.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.methodCard, selected && styles.selectedCard]}
              >
                <Text variant="body" weight="bold" tone={selected ? 'accent' : 'primary'}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Card>
        <Text variant="body" tone="secondary">
          {METHOD_BLURB[method]}
        </Text>
        {method === 'instapay' ? (
          <View style={styles.payee}>
            <Text variant="caption" tone="muted">
              Transfer to · InstaPay mobile number
            </Text>
            <Pressable
              onPress={onCopyInstapay}
              accessibilityRole="button"
              accessibilityLabel={`Copy InstaPay number ${INSTAPAY_PHONE}`}
              style={styles.copyRow}
            >
              <Text variant="h2" weight="bold" style={styles.payeeNumber}>
                {INSTAPAY_PHONE}
              </Text>
              <View style={styles.copyHint}>
                <Ionicons
                  name={copied ? 'checkmark-circle' : 'copy-outline'}
                  size={18}
                  color={copied ? color.status.success : color.accent.default}
                />
                <Text variant="caption" tone="accent">
                  {copied ? 'Copied' : 'Tap to copy'}
                </Text>
              </View>
            </Pressable>
            <Text variant="caption" tone="muted">
              {INSTAPAY_PAYEE_NAME
                ? `Account name: ${INSTAPAY_PAYEE_NAME} — check it matches before you send.`
                : 'Account name: confirming — check the number matches before you send.'}
            </Text>
          </View>
        ) : null}
      </Card>

      {/* Optional proof */}
      <View style={styles.field}>
        <Text variant="label">Screenshot (optional)</Text>
        <Button
          variant="ghost"
          label={uploading ? 'Uploading…' : proofPath ? 'Replace screenshot' : 'Add a screenshot'}
          onPress={onAddProof}
          disabled={uploading}
        />
        {proofPath ? (
          <Text variant="caption" tone="accent">
            Screenshot attached ✓
          </Text>
        ) : (
          <Text variant="caption" tone="muted">
            A transfer screenshot helps the academy confirm faster — but it’s optional.
          </Text>
        )}
        {uploadNote ? (
          <Text variant="caption" tone="secondary">
            {uploadNote}
          </Text>
        ) : null}
      </View>

      {error ? (
        <Text variant="caption" tone="accent" style={styles.center}>
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  gap: { marginTop: space.sm },
  priceRow: { marginTop: space.md },
  field: { gap: space.sm },
  methodRow: { flexDirection: 'row', gap: space.md },
  methodCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.bg.surface,
  },
  selectedCard: { borderColor: color.accent.default, backgroundColor: color.bg.canvas },
  payee: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.bg.canvas,
    gap: space.xs,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  payeeNumber: { letterSpacing: 0.5 },
  copyHint: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  center: { textAlign: 'center' },
});
