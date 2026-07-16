import { formatPiastres } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { PackageId, Piastres } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PLAYER_COUNT, packageById, packageIncludes, perSessionPiastres } from '../../data/catalog';
import {
  Button,
  Card,
  CheckList,
  InfoCard,
  Money,
  PillOnNavy,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../../ui';

/** 10 — Package detail. Navy summary card, what's included, expiry note, sticky BUY. */
export default function PackageDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pkg = packageById(id as PackageId);

  if (!pkg) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Session bundles" title="Not Found" onBack={() => router.back()} />
        <Text variant="body" tone="secondary">
          This package is no longer available.
        </Text>
      </Screen>
    );
  }

  const meta = TRAINING_META[pkg.trainingType];
  const perSession = perSessionPiastres(pkg) as Piastres;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          eyebrow={`${meta.label} training`}
          title="Package Details"
          onBack={() => router.back()}
        />

        <Card variant="inverse">
          <PillOnNavy label={meta.label} icon={meta.icon} />
          <Text variant="display" tone="inverse" style={styles.title}>
            {`${pkg.sessionCount} ${meta.label} sessions`}
          </Text>
          <Text variant="caption" tone="inverse">
            {PLAYER_COUNT[pkg.trainingType]}
          </Text>
          <View style={styles.priceRow}>
            <Money amount={pkg.price} tone="inverse" variant="display" />
            <PillOnNavy label={`${formatPiastres(perSession)} / session`} />
          </View>
        </Card>

        <View style={styles.section}>
          <Text variant="label">What&apos;s included</Text>
          <Card>
            <CheckList items={packageIncludes(pkg)} />
          </Card>
        </View>

        <InfoCard
          variant="amber"
          text="Credits are valid 30 days from purchase. Unused credits expire — plan your month."
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={`Buy for ${formatPiastres(pkg.price)}`}
          onPress={() => router.push({ pathname: '/checkout', params: { packageId: pkg.id } })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.lg },
  title: { marginTop: space.md },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  section: { gap: space.sm },
  footer: {
    padding: space.xl,
    borderTopWidth: 1,
    borderTopColor: color.border.subtle,
    backgroundColor: color.bg.canvas,
  },
});
