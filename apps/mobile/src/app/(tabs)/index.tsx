import { TRAINING_TYPES, formatExpiry, formatInstantDate, formatInstantTime } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { Package, Piastres } from '@tpa/types';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { balanceByType, soonestExpiringBatch, totalReadyToBook } from '../../data/wallet';
import { nextSession, perSessionPiastres, topUpPackages } from '../../data/schedule';
import { useSession } from '../../session/SessionProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  IconRow,
  InfoCard,
  Money,
  PillOnNavy,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../../ui';

const ACADEMY = {
  name: 'Oro Plaza Hotel',
  address: 'In front of Family Park, Rehab, Cairo',
  hours: 'Sun – Wed · 5:00 PM – 11:00 PM',
  hoursNote: 'Group training mainly 5 – 9 PM',
} as const;

export default function HomeScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  if (!player) return null;

  const firstName = player.name.split(' ')[0] ?? player.name;
  const total = totalReadyToBook(player.id, now);
  const balance = balanceByType(player.id, now);
  const expiring = soonestExpiringBatch(player.id, now);
  const next = nextSession(player.id, now);
  const packages = topUpPackages();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader
        eyebrow="The Padel Academy"
        title={`Hey, ${firstName}`}
        trailing={<Avatar name={player.name} />}
      />

      {/* Navy hero credits card */}
      <Card variant="inverse">
        <View style={styles.heroTop}>
          <Text variant="label">Your credits</Text>
          <View style={styles.walletChip}>
            <PillOnNavy label="Wallet" trailingIcon="arrow-forward" />
          </View>
        </View>

        <View style={styles.heroCount}>
          <Text variant="display" tone="inverse">
            {String(total)}
          </Text>
          <Text variant="caption" tone="inverse" style={styles.heroCountLabel}>
            {'credits\nready to book'}
          </Text>
        </View>

        <View style={styles.balancePills}>
          {TRAINING_TYPES.map((t) => (
            <PillOnNavy
              key={t}
              icon={TRAINING_META[t].icon}
              label={`${balance[t]} ${TRAINING_META[t].label}`}
              dimmed={balance[t] === 0}
            />
          ))}
        </View>

        {expiring ? (
          <InfoCard
            variant="amber"
            style={styles.expiryStrip}
            text={`${expiring.quantityRemaining} ${TRAINING_META[expiring.trainingType].label} credit${
              expiring.quantityRemaining === 1 ? '' : 's'
            } — ${formatExpiry(expiring.expiresAt, now)}`}
          />
        ) : null}
      </Card>

      <Button label="Book a Session" onPress={() => router.push('/(tabs)/book')} />

      {/* Next session */}
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
              <Badge label={TRAINING_META[next.slot.trainingType].label} icon={TRAINING_META[next.slot.trainingType].icon} />
            </View>
            <View style={styles.divider} />
            <IconRow icon="location-outline" title={`${ACADEMY.name} · Rehab`} />
          </Card>
        </View>
      ) : null}

      {/* Top up credits */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="label">Top up credits</Text>
          <Text variant="label" tone="accent" onPress={() => router.push('/wallet')}>
            See all
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.packageScroll}
        >
          {packages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </ScrollView>
      </View>

      {/* The academy */}
      <View style={styles.section}>
        <Text variant="label">The academy</Text>
        <Card>
          <IconRow icon="location-outline" title={ACADEMY.name} subtitle={ACADEMY.address} />
          <View style={styles.divider} />
          <IconRow icon="time-outline" title={ACADEMY.hours} subtitle={ACADEMY.hoursNote} />
        </Card>
      </View>

      <Text variant="caption" tone="muted" style={styles.devLink} onPress={() => router.push('/gallery')}>
        Dev · Component gallery
      </Text>
    </ScrollView>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const meta = TRAINING_META[pkg.trainingType];
  const isBestValue = pkg.sessionCount === 8;
  return (
    <Card style={styles.packageCard}>
      {isBestValue ? (
        <View style={styles.bestValue}>
          <Badge label="Best value" tint={{ fg: color.text.inverse, bg: color.accent.default }} />
        </View>
      ) : null}
      <Badge label={meta.label} icon={meta.icon} />
      <Text variant="h2">{`${pkg.sessionCount} Sessions`}</Text>
      <Money amount={pkg.price} tone="accent" variant="h2" />
      <View style={styles.perSession}>
        <Money amount={perSessionPiastres(pkg) as Piastres} variant="caption" tone="muted" />
        <Text variant="caption" tone="muted">
          {' / session'}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg.canvas },
  content: { padding: space.xl, gap: space.lg },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletChip: {},
  heroCount: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  heroCountLabel: {},
  balancePills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  expiryStrip: { marginTop: space.md },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nextInfo: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
  packageScroll: { gap: space.md, paddingVertical: space.xs },
  packageCard: { width: 190, gap: space.sm },
  perSession: { flexDirection: 'row', alignItems: 'center' },
  bestValue: { position: 'absolute', top: space.sm, insetInlineEnd: space.sm, zIndex: 1 },
  devLink: { textAlign: 'center', marginTop: space.md },
});
