import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PLAYER_COUNT, PURCHASABLE_TYPES, packagesByType } from '../data/catalog';
import { usePackages } from '../data/queries';
import { ErrorView, IconRow, LoadingView, PackageRow, Screen, ScreenHeader, Text, TRAINING_META } from '../ui';

/** 09 — Buy credits. Sections per purchasable training type; trial never appears. */
export default function BuyCreditsScreen() {
  const router = useRouter();
  const packagesQ = usePackages();

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
          {PURCHASABLE_TYPES.map((type) => (
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
