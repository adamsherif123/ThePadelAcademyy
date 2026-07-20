import { formatExpiry, formatInstantDate, formatInstantTime } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { CreditBatchId } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { activePackages } from '../../data/catalog';
import { useBatches, useBookings, useCoaches, usePackages, useSlots, combine } from '../../data/queries';
import { nextSession } from '../../data/schedule';
import { soonestExpiringBatch, totalReadyToBook } from '../../data/wallet';
import { NotificationBell } from '../../notifications/NotificationBell';
import { useSession } from '../../session/SessionProvider';
import {
  ACADEMY,
  AcademyCard,
  Avatar,
  Badge,
  Button,
  Card,
  CreditsSummaryCard,
  ErrorView,
  IconRow,
  InfoCard,
  LoadingView,
  PackageCard,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../../ui';

export default function HomeScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const batches = useBatches();
  const bookings = useBookings();
  const slots = useSlots();
  const coaches = useCoaches();
  const packagesQ = usePackages();
  const gate = combine(batches, bookings, slots, coaches, packagesQ);
  // Session-scoped, in-memory dismissals, keyed by batch id — a nag by design:
  // pure view state, resets on relaunch, and keying by id means dismissing one
  // batch's notice doesn't suppress a different batch's later.
  const [dismissed, setDismissed] = useState<Set<CreditBatchId>>(() => new Set());
  if (!player) return null;

  const firstName = player.name.split(' ')[0] ?? player.name;
  const header = (
    <ScreenHeader
      eyebrow="The Padel Academy"
      title={`Hey, ${firstName}`}
      trailing={
        <View style={styles.headerTrailing}>
          <NotificationBell />
          <Avatar name={player.name} />
        </View>
      }
    />
  );
  if (gate.isPending) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <LoadingView />
      </Screen>
    );
  }
  if (gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <ErrorView onRetry={gate.refetch} />
      </Screen>
    );
  }

  const total = totalReadyToBook(batches.data ?? [], now);
  const expiring = soonestExpiringBatch(batches.data ?? [], now);
  const next = nextSession(bookings.data ?? [], slots.data ?? [], coaches.data ?? [], now);
  const packages = activePackages(packagesQ.data ?? []);

  const expiryText = expiring
    ? `${expiring.quantityRemaining} ${TRAINING_META[expiring.trainingType].label} credit${
        expiring.quantityRemaining === 1 ? '' : 's'
      } — ${formatExpiry(expiring.expiresAt, now)}`
    : undefined;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      {header}

      <CreditsSummaryCard
        total={total}
        eyebrow="Your credits"
        action={{ label: 'Wallet', trailingIcon: 'arrow-forward', onPress: () => router.push('/wallet') }}
      >
        {expiring && expiryText && !dismissed.has(expiring.id) ? (
          <InfoCard
            size="sm"
            variant="amber"
            text={expiryText}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(expiring.id))}
          />
        ) : null}
      </CreditsSummaryCard>

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
          <Text variant="label">Add credits</Text>
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
  headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  content: { gap: space.lg },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nextInfo: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
  packageScroll: { gap: space.md, paddingVertical: space.xs },
  devLink: { textAlign: 'center', marginTop: space.md },
});
