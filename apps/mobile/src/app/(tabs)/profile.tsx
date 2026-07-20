import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { playerPurchases } from '../../data/purchases';
import { useBatches, useCoaches, usePurchases, combine } from '../../data/queries';
import { totalReadyToBook } from '../../data/wallet';
import { useSession } from '../../session/SessionProvider';
import {
  AcademyCard,
  Avatar,
  Badge,
  Button,
  Card,
  CircleIconButton,
  ErrorView,
  GENDER_LABEL,
  LEVEL_LABEL,
  LinkRow,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
} from '../../ui';

/** 15 — Profile. Identity card, links, academy, sign out. */
export default function ProfileScreen() {
  const router = useRouter();
  const { player, now, signOut } = useSession();
  const batches = useBatches();
  const purchases = usePurchases();
  const coaches = useCoaches();
  const gate = combine(batches, purchases, coaches);
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your account" title="Profile" />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const usable = totalReadyToBook(batches.data ?? [], now);
  const purchaseCount = playerPurchases(purchases.data ?? []).length;
  const coachCount = (coaches.data ?? []).length;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Your account" title="Profile" />

      <Card>
        <View style={styles.identity}>
          <Avatar name={player.name} size={60} />
          <View style={styles.identityText}>
            <Text variant="h2">{player.name}</Text>
            <Text variant="caption" tone="secondary">
              {player.phone}
            </Text>
          </View>
          <CircleIconButton icon="pencil" accessibilityLabel="Edit profile" onPress={() => {}} />
        </View>
        <View style={styles.tags}>
          <Badge label={GENDER_LABEL[player.gender]} />
          <Badge label={LEVEL_LABEL[player.level]} />
        </View>
      </Card>

      <View style={styles.links}>
        <LinkRow icon="wallet-outline" title="Wallet" subtitle={`${usable} usable credits`} onPress={() => router.push('/wallet')} />
        <LinkRow
          icon="receipt-outline"
          title="Purchase history"
          subtitle={`${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'}`}
          onPress={() => router.push('/purchase-history')}
        />
        <LinkRow icon="people-outline" title="Meet the coaches" subtitle={`${coachCount} academy coaches`} onPress={() => router.push('/coaches')} />
      </View>

      <View style={styles.section}>
        <Text variant="label">The academy</Text>
        <AcademyCard />
      </View>

      <Button
        label="Sign out"
        variant="secondary"
        destructive
        icon="log-out-outline"
        onPress={() => void signOut()}
      />

      {/* Heavier than sign-out and set apart: a ghost danger link to the gated
          confirm screen (Apple 5.1.1(v) in-app deletion). */}
      <Button
        label="Delete account"
        variant="ghost"
        destructive
        icon="trash-outline"
        size="sm"
        onPress={() => router.push('/delete-account')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityText: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  links: { gap: space.md },
  section: { gap: space.sm },
});
