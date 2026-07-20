import { formatPiastres, unusedCreditValue } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBatches, usePackages, usePurchases, combine } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  Button,
  Card,
  ErrorView,
  InfoCard,
  Input,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
} from '../ui';

const CONFIRM_WORD = 'DELETE';

/**
 * Delete account — the confirmation gate (Apple 5.1.1(v)). A sibling to the
 * cancel/forfeit screens in tone: blunt about the consequences, easy to back out of.
 * It names exactly what's lost (including the EGP value of unused credits, so the
 * loss is a real number), demands an unmissable type-to-confirm, and only then calls
 * the Edge Function. Deletion anonymises server-side; credits are abandoned, and
 * financial history survives attributed to the tombstone.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { player, now, deleteAccount } = useSession();
  const batchesQ = useBatches();
  const purchasesQ = usePurchases();
  const packagesQ = usePackages();
  const gate = combine(batchesQ, purchasesQ, packagesQ);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Account" title="Delete account" onBack={() => router.back()} />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const { count, valuePiastres } = unusedCreditValue(
    batchesQ.data ?? [],
    purchasesQ.data ?? [],
    packagesQ.data ?? [],
    now,
  );

  const armed = confirm.trim().toUpperCase() === CONFIRM_WORD && !deleting;

  const onDelete = async () => {
    if (!armed) return;
    setDeleting(true);
    setError(null);
    const res = await deleteAccount();
    // On success the session is torn down and the auth guard routes to sign-in — no
    // navigation needed here. On failure we stay put so the user can retry.
    if (!res.ok) {
      setDeleting(false);
      setError(res.error ?? 'We couldn’t delete your account. Please try again.');
    }
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          <Button
            label={deleting ? 'Deleting…' : 'Delete my account'}
            variant="secondary"
            destructive
            icon="trash-outline"
            disabled={!armed}
            loading={deleting}
            onPress={onDelete}
          />
          <Button label="Keep my account" onPress={() => router.back()} disabled={deleting} />
        </View>
      }
    >
      <ScreenHeader eyebrow="Account" title="Delete account" onBack={() => router.back()} />

      {error ? <InfoCard variant="amber" icon="alert-circle-outline" text={error} /> : null}

      <InfoCard
        variant="danger"
        icon="warning-outline"
        text="This permanently deletes your account. It can’t be undone."
      />

      <Card>
        <Text variant="label">What you’ll lose</Text>
        <View style={styles.list}>
          <Bullet text="Your account and profile" />
          <Bullet text="Access to your booking history" />
          {count > 0 ? (
            <Bullet
              text={`${count} unused credit${count === 1 ? '' : 's'}${
                valuePiastres > 0 ? ` — worth about ${formatPiastres(valuePiastres)}` : ''
              }`}
            />
          ) : null}
        </View>
        <Text variant="body" tone="secondary" style={styles.tail}>
          If you sign up again later, you’ll start fresh — none of this comes back.
        </Text>
      </Card>

      <View style={styles.confirmBlock}>
        <Input
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={CONFIRM_WORD}
          disabled={deleting}
        />
      </View>
    </Screen>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text variant="body" tone="secondary">
        •
      </Text>
      <Text variant="body" tone="secondary" style={styles.bulletText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  list: { gap: space.xs, marginTop: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm },
  bulletText: { flex: 1 },
  tail: { marginTop: space.md },
  confirmBlock: { gap: space.sm },
  footer: { gap: space.sm },
});
