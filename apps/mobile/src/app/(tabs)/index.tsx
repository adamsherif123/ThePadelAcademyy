import { formatExpiry, formatInstantDate, formatInstantTime } from '@tpa/core';
import { color, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { activePackages } from '../../data/catalog';
import { nextSession } from '../../data/schedule';
import { useDataStore } from '../../data/store';
import { balanceByType, soonestExpiringBatch, totalReadyToBook } from '../../data/wallet';
import { useSession } from '../../session/SessionProvider';
import {
  ACADEMY,
  AcademyCard,
  Avatar,
  Badge,
  Button,
  Card,
  CreditsSummaryCard,
  IconRow,
  PackageCard,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../../ui';

export default function HomeScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  useDataStore(); // re-render when a purchase grants credits
  if (!player) return null;

  const firstName = player.name.split(' ')[0] ?? player.name;
  const total = totalReadyToBook(player.id, now);
  const balance = balanceByType(player.id, now);
  const expiring = soonestExpiringBatch(player.id, now);
  const next = nextSession(player.id, now);
  const packages = activePackages();

  const expiryText = expiring
    ? `${expiring.quantityRemaining} ${TRAINING_META[expiring.trainingType].label} credit${
        expiring.quantityRemaining === 1 ? '' : 's'
      } — ${formatExpiry(expiring.expiresAt, now)}`
    : undefined;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader
        eyebrow="The Padel Academy"
        title={`Hey, ${firstName}`}
        trailing={<Avatar name={player.name} />}
      />

      <CreditsSummaryCard
        total={total}
        balance={balance}
        eyebrow="Your credits"
        action={{ label: 'Wallet', trailingIcon: 'arrow-forward', onPress: () => router.push('/wallet') }}
        expiringText={expiryText}
      />

      <Button label="Book a Session" onPress={() => router.push('/(tabs)/book')} />

      {next ? (
        <View style={styles.section}>
          <Text variant="label">Next session</Text>
          <Card>
            <View style={styles.nextRow}>
              <Avatar name={next.coach?.name ?? 'Coach'} imageUrl={next.coach?.photoUrl} size={48} />
              <View style={styles.nextInfo}>
                <Text variant="body" weight="bold">
                  {`${formatInstantDate(next.slot.startsAt)} · ${formatInstantTime(next.slot.startsAt)}`}
                </Text>
                <Text variant="caption" tone="secondary">
                  {next.coach ? `with ${next.coach.name}` : ''}
                </Text>
              </View>
              <Badge
                label={TRAINING_META[next.slot.trainingType].label}
                icon={TRAINING_META[next.slot.trainingType].icon}
              />
            </View>
            <View style={styles.divider} />
            <IconRow icon="location-outline" title={ACADEMY.locationLine} />
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="label">Top up credits</Text>
          <Text variant="label" tone="accent" onPress={() => router.push('/buy-credits')}>
            See all
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packageScroll}>
          {packages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} onPress={() => router.push(`/package/${pkg.id}`)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text variant="label">The academy</Text>
        <AcademyCard />
      </View>

      <Text variant="caption" tone="muted" style={styles.devLink} onPress={() => router.push('/gallery')}>
        Dev · Component gallery
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nextInfo: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
  packageScroll: { gap: space.md, paddingVertical: space.xs },
  devLink: { textAlign: 'center', marginTop: space.md },
});
