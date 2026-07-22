import type { TrainingType } from '@tpa/types';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PLAYER_COUNT, PURCHASABLE_TYPES, packagesByType } from '../data/catalog';
import { usePackages, useTrialEligible } from '../data/queries';
import { ErrorView, IconRow, LoadingView, PackageRow, Screen, ScreenHeader, Text, TRAINING_META } from '../ui';

/**
 * 09 — Buy credits. Sections per training type. A5: the once-per-player trial appears at the
 * top ONLY while the player is still eligible (never bought/requested one) and an active trial
 * package exists; a player who has used their trial never sees it here.
 */
export default function BuyCreditsScreen() {
  const router = useRouter();
  const packagesQ = usePackages();
  const trialEligibleQ = useTrialEligible();

  const showTrial =
    Boolean(trialEligibleQ.data) && packagesByType(packagesQ.data ?? [], 'trial').length > 0;
  const sections: TrainingType[] = showTrial ? ['trial', ...PURCHASABLE_TYPES] : PURCHASABLE_TYPES;

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Session bundles" title="Buy Credits" onBack={() => router.back()} />

      {packagesQ.isPending || packagesQ.isError ? (
        packagesQ.isPending ? (
          <LoadingView />
        ) : (
          <ErrorView onRetry={packagesQ.refetch} />
        )
      ) : (
        <>
          {sections.map((type) => (
            <View key={type} style={styles.section}>
              <IconRow
                icon={TRAINING_META[type].icon}
                title={`${TRAINING_META[type].label} training`}
                subtitle={PLAYER_COUNT[type]}
              />
              {packagesByType(packagesQ.data ?? [], type).map((pkg) => (
                <PackageRow key={pkg.id} pkg={pkg} onPress={() => router.push(`/package/${pkg.id}`)} />
              ))}
            </View>
          ))}

          <Text variant="caption" tone="muted" style={styles.footer}>
            Credits are typed — a Group credit books Group sessions only.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  section: { gap: space.sm },
  footer: { textAlign: 'center', marginTop: space.sm },
});
