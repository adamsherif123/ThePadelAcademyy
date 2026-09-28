import Ionicons from '@expo/vector-icons/Ionicons';
import { sessionCountLabel } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { LocationId, PackageId } from '@tpa/types';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { defaultTrialBranch, packageById, trialBranches, trialPackageAt } from '../data/catalog';
import { useLocations, useMyCreditRequests, usePackages } from '../data/queries';
import { pendingTrialBranchName, trialRefusalKind } from '../data/trialRequest';
import { requestCreditsRpc, uploadProof, type RequestCreditsReason } from '../lib/api';
import { haptics } from '../lib/haptics';
import { resetTo, resetToTab } from '../lib/nav';
import { queryClient, queryKeys } from '../lib/queryClient';
import { useLocation } from '../location/LocationProvider';
import { LocationMenu } from '../location/LocationMenu';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';
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
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
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
      // A full-width row, not the toggle's compact pill. On the Book tab the pill
      // is an ambient label you may never touch; here it is a decision inside a
      // form, sitting beside "How did you pay?", and it has to carry the same
      // weight as the control below it or it reads as a caption.
      branchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.border.strong,
        backgroundColor: color.bg.surface,
      },
      branchName: { flex: 1 },
      branchAnchor: { alignSelf: 'stretch' },
    }),
    [color],
  );
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  const { player } = useSession();
  const packagesQ = usePackages();
  const locationsQ = useLocations();
  const { selectedId, select } = useLocation();
  // Only to tell the two meanings of `trial_already_used` apart — see trialPending.
  const myRequestsQ = useMyCreditRequests();

  const [method, setMethod] = useState<Method>('instapay');
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'submitted' | 'already_pending' | 'trial_pending' | null>(null);
  const [copied, setCopied] = useState(false);
  // The branch the TRIAL will be at. Null means "not chosen yet / not a trial";
  // the effective package below falls back to the one this screen was opened with.
  const [trialBranchId, setTrialBranchId] = useState<LocationId | null>(null);

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

  const openedWith = packageById(packagesQ.data ?? [], packageId as PackageId);
  const isTrial = openedWith?.trainingType === 'trial';

  // ── which branch will this trial be at ──────────────────────────────────────
  // There is no branch field on a request: the PACKAGE decides where the credits
  // work (tpa.force_location_from_package). So picking a branch means picking
  // that branch's trial package, and everything below — the card, the price, the
  // submit — follows from `pkg` rather than from a separate piece of state.
  const branches = isTrial ? trialBranches(packagesQ.data ?? [], locationsQ.data ?? []) : [];
  const chosenBranch = isTrial ? defaultTrialBranch(branches, trialBranchId ?? selectedId) : null;
  const trialPkg = chosenBranch ? trialPackageAt(packagesQ.data ?? [], chosenBranch.id) : null;
  const pkg = trialPkg ?? openedWith;
  // Only shown when there is a real choice. One eligible branch and the screen is
  // exactly the screen it was before this existed — same rule as the toggle.
  const showBranchPicker = isTrial && branches.length > 1;

  // The package's OWN branch, not the toggle's: this flow is about one package.
  const pkgLocationName = (locationsQ.data ?? []).find((l) => l.id === pkg?.locationId)?.name ?? null;

  // ── the two meanings of `trial_already_used` ────────────────────────────────
  // The RPC returns one reason for two situations: a trial already PURCHASED, and
  // a live trial request sitting at some branch (tpa.trial_used counts both). The
  // second is the likely one here — a player picks a branch, submits, then comes
  // back and picks another — and "you've already used your trial" is simply untrue
  // for them. The client can tell them apart without a migration: it can read its
  // own credit_requests. This is that read; the copy below uses it.
  const pendingTrialBranch = pendingTrialBranchName(myRequestsQ.data ?? [], locationsQ.data ?? []);
  const hasPendingTrial = (myRequestsQ.data ?? []).some((r) => r.isTrial && r.status === 'pending');

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
        haptics.success();
        // The trial will be usable at the branch they just chose, so point the app
        // there: the Book tab is the next place they look, and it must be showing
        // the branch their credit is coming to rather than wherever they browsed
        // before. Only on success, and only for the trial — a normal request is
        // for a package the player opened deliberately and implies no move.
        if (isTrial && chosenBranch) select(chosenBranch.id);
        await queryClient.invalidateQueries({ queryKey: queryKeys.creditRequests });
        setOutcome('submitted');
        return;
      }
      if (res.reason === 'already_pending') {
        setOutcome('already_pending');
        return;
      }
      // `trial_already_used` covers two different players. One has a trial request
      // already waiting somewhere — nothing is wrong, they just cannot have two —
      // and for them this is the same terminal "you have one pending" state as
      // above, not a red error under the button. The other really has used their
      // trial, and still gets the plain refusal.
      if (trialRefusalKind(res.reason, hasPendingTrial) === 'trial_pending') {
        setOutcome('trial_pending');
        return;
      }
      haptics.error();
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
    const pending = outcome !== 'submitted';
    // Two different pendings. `already_pending` is the per-branch limit (066): a
    // request for THIS branch is already waiting, and another branch is still open
    // to them. `trial_pending` is the once-ever trial: the branch does not matter,
    // there is one trial and it is already claimed — and saying "you can still
    // request another location" there would be a straight lie.
    const trialPending = outcome === 'trial_pending';
    return (
      <Screen>
        <SuccessView
          icon={pending ? 'time-outline' : 'checkmark'}
          tone={pending ? 'accent' : 'success'}
          eyebrow={pending ? 'Request pending' : 'Request submitted'}
          title={
            trialPending
              ? 'Your trial request is already in'
              : pending
                ? 'You already have a request pending'
                : 'Thanks — request submitted'
          }
          primary={{ label: 'Go to wallet', onPress: () => resetTo('/wallet') }}
          secondary={{ label: 'Go home', onPress: () => resetToTab('/(tabs)') }}
        >
          <Card>
            <Text variant="body" tone="secondary">
              {trialPending
                ? `You already have a trial request pending for ${pendingTrialBranch ?? 'another location'}. There is one trial per player, so you can't request a second — if you meant a different location, ask the academy to decline the first one.`
                : pending
                  ? // 066 made the limit PER BRANCH, so the copy has to say which one —
                    // otherwise a player with a pending request at Oro reads this as
                    // "I can't request anywhere", which is no longer true.
                    `You have a credit request for ${pkgLocationName ?? 'this location'} awaiting the academy’s confirmation. Track it in your wallet — you can still request credits for another location.`
                  : `Your credits${pkgLocationName ? ` for ${pkgLocationName}` : ''} will be added once the academy confirms your payment — this isn’t instant. You’ll get a notification, and you can track the status in your wallet.`}
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

      {/* ABOVE the package card, because the card is its consequence: change the
          branch and the name, session count and price below all change with it. */}
      {showBranchPicker && chosenBranch ? (
        <View style={styles.field}>
          <Text variant="label">Where will you play?</Text>
          <LocationMenu
            options={branches}
            selectedId={chosenBranch.id}
            onSelect={setTrialBranchId}
            // The row is a form field and spans the screen; the menu matches it.
            anchorStyle={styles.branchAnchor}
            trigger={({ open, toggle }) => (
              <Pressable
                style={styles.branchRow}
                onPress={toggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Trial location: ${chosenBranch.name}. Tap to change.`}
              >
                <Ionicons name="location-outline" size={18} color={color.text.secondary} />
                <Text variant="body" weight="semibold" style={styles.branchName} numberOfLines={1}>
                  {chosenBranch.name}
                </Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={color.text.muted} />
              </Pressable>
            )}
          />
          <Text variant="caption" tone="muted">
            Your trial credit will only work at this location.
          </Text>
        </View>
      ) : null}

      {/* What they're requesting */}
      <Card variant="inverse">
        <PillOnNavy label={meta.label} icon={meta.icon} />
        <Text variant="h2" tone="inverse" style={styles.gap}>
          {sessionCountLabel(pkg.sessionCount, meta.label)}
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
