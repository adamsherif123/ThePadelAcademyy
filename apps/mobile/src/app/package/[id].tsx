import { CREDIT_EXPIRY_DAYS, formatPiastres, sessionCountLabel } from '@tpa/core';
import { space } from '@tpa/theme';
import type { PackageId, Piastres } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PLAYER_COUNT, packageById, packageIncludes, perSessionPiastres } from '../../data/catalog';
import { useLocations, usePackages, useTrialEligible } from '../../data/queries';
import { PAYMOB_ENABLED } from '../../lib/featureFlags';
import {
  Button,
  Card,
  CheckList,
  ErrorView,
  InfoCard,
  LoadingView,
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
  const packagesQ = usePackages();
  const trialEligibleQ = useTrialEligible();
  // NOT branch-filtered: this screen is reachable directly by id (a share, a
  // bookmark), and a package that exists should resolve. It states its branch
  // instead — which is the thing the player needs to know before paying.
  const locationsQ = useLocations();

  if (packagesQ.isPending || packagesQ.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Session bundles" title="Package Details" onBack={() => router.back()} />
        {packagesQ.isPending ? <LoadingView /> : <ErrorView onRetry={packagesQ.refetch} />}
      </Screen>
    );
  }

  const pkg = packageById(packagesQ.data ?? [], id as PackageId);

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

  const isTrial = pkg.trainingType === 'trial';
  // Null while locations load, or if the branch row is gone — the card is simply
  // omitted rather than asserting a place we cannot name.
  const pkgLocationName = (locationsQ.data ?? []).find((l) => l.id === pkg.locationId)?.name ?? null;

  // A package's own listing (buy-credits, home) already hides the trial from an ineligible
  // player, but this screen is reachable directly by id (a stale link, a share, a bookmark),
  // so it needs its own trial_eligible() check — "no trial-purchase option anywhere" means
  // here too, not just in the lists that lead here.
  if (isTrial && trialEligibleQ.isPending) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Session bundles" title="Package Details" onBack={() => router.back()} />
        <LoadingView />
      </Screen>
    );
  }
  const trialBlocked = isTrial && !trialEligibleQ.data;

  const meta = TRAINING_META[pkg.trainingType];
  const perSession = perSessionPiastres(pkg) as Piastres;

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        trialBlocked ? (
          <Button label="Browse other packages" onPress={() => router.replace('/buy-credits')} />
        ) : // Paymob is off (mothballed): route to the report-a-payment request flow. When the
        // flag is flipped on, the original Paymob checkout journey returns unchanged.
        PAYMOB_ENABLED ? (
          <Button
            label={`Buy for ${formatPiastres(pkg.price)}`}
            onPress={() => router.push({ pathname: '/checkout', params: { packageId: pkg.id } })}
          />
        ) : (
          <Button
            label="Request these credits"
            onPress={() => router.push({ pathname: '/request-credits', params: { packageId: pkg.id } })}
          />
        )
      }
    >
      <ScreenHeader
        eyebrow={`${meta.label} training`}
        title="Package Details"
        onBack={() => router.back()}
      />

        <Card variant="inverse">
          <PillOnNavy label={meta.label} icon={meta.icon} />
          <Text variant="display" tone="inverse" style={styles.title}>
            {sessionCountLabel(pkg.sessionCount, meta.label)}
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

      {/* Before the expiry note, because WHERE the credits work is the thing a
          player can get wrong by paying — expiry only bites later. */}
      {pkgLocationName ? (
        <InfoCard
          variant="neutral"
          icon="location-outline"
          text={`Credits for ${pkgLocationName}. They can only be used at this location.`}
        />
      ) : null}

      <InfoCard
        variant="amber"
        text={
          trialBlocked
            ? 'You’ve already used your one-time trial session — browse our other packages instead.'
            : `Credits are valid ${CREDIT_EXPIRY_DAYS} days from purchase. Unused credits expire — plan your month.`
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  title: { marginTop: space.md },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md, flexWrap: 'wrap' },
  section: { gap: space.sm },
});
