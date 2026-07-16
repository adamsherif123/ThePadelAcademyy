import { color, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { allCoaches } from '../../data/schedule';
import { playerPurchases } from '../../data/purchases';
import { useDataStore } from '../../data/store';
import { totalReadyToBook } from '../../data/wallet';
import { useSession } from '../../session/SessionProvider';
import {
  AcademyCard,
  Avatar,
  Badge,
  Button,
  Card,
  CircleIconButton,
  LinkRow,
  ScreenHeader,
  Text,
} from '../../ui';

const GENDER_LABEL = { men: 'Men', ladies: 'Ladies' } as const;
const LEVEL_LABEL = {
  beginner: 'Beginner',
  adv_beginner: 'Advanced Beginner',
  intermediate: 'Intermediate',
} as const;

/** 15 — Profile. Identity card, links, academy, sign out. */
export default function ProfileScreen() {
  const router = useRouter();
  const { player, now, signOut } = useSession();
  useDataStore();
  if (!player) return null;

  const usable = totalReadyToBook(player.id, now);
  const purchaseCount = playerPurchases(player.id).length;
  const coachCount = allCoaches().length;

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
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

      <Button label="Sign out" variant="secondary" destructive icon="log-out-outline" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg.canvas },
  content: { padding: space.xl, gap: space.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityText: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  links: { gap: space.md },
  section: { gap: space.sm },
});
