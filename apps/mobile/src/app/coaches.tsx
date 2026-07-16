import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { allCoaches } from '../data/schedule';
import { Avatar, Badge, Card, Screen, ScreenHeader, Text } from '../ui';

/**
 * Meet the coaches (undesigned — built to the established pattern). The 4 mock
 * coaches with photos, names, and specialties; inactive coaches are marked.
 */
export default function CoachesScreen() {
  const router = useRouter();
  const coaches = allCoaches();

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
