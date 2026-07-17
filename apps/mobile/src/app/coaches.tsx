import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useCoaches } from '../data/queries';
import { Avatar, Badge, Card, ErrorView, LoadingView, Screen, ScreenHeader, Text } from '../ui';

/**
 * Meet the coaches (undesigned — built to the established pattern). The active
 * academy coaches with photos, names, and specialties, read live via RLS.
 */
export default function CoachesScreen() {
  const router = useRouter();
  const coachesQ = useCoaches();

  if (coachesQ.isPending || coachesQ.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="The team" title="Meet the Coaches" onBack={() => router.back()} />
        {coachesQ.isPending ? <LoadingView /> : <ErrorView onRetry={coachesQ.refetch} />}
      </Screen>
    );
  }

  const coaches = coachesQ.data ?? [];

  return (
    <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="The team" title="Meet the Coaches" onBack={() => router.back()} />

        {coaches.map((coach) => (
          <Card key={coach.id}>
            <View style={styles.row}>
              <Avatar name={coach.name} imageUrl={coach.photoUrl} size={56} />
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text variant="body" weight="bold">
                    {coach.name}
                  </Text>
                  {!coach.isActive ? <Badge label="On leave" tone="warning" /> : null}
                </View>
                <Text variant="caption" tone="secondary">
                  {coach.bio}
                </Text>
              </View>
            </View>
          </Card>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  info: { flex: 1, gap: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
});
