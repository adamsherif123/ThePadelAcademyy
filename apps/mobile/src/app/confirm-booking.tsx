import { space } from '@tpa/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Screen, ScreenHeader, Text } from '../ui';

/**
 * Placeholder only — S3d builds the real confirm screen (order summary, the
 * credit that will be spent, and the atomic book RPC). Book routes here with the
 * chosen slot so the navigation seam exists now.
 */
export default function ConfirmBookingScreen() {
  const router = useRouter();
  const { slotId } = useLocalSearchParams<{ slotId: string }>();

  return (
    <Screen>
      <ScreenHeader eyebrow="Confirm" title="Confirm Booking" onBack={() => router.back()} />
      <View style={styles.body}>
        <Text variant="body" tone="secondary">
          Confirm & credit spend land in S3d.
        </Text>
        <Text variant="caption" tone="muted">
          {`slot: ${slotId ?? '—'}`}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.lg, gap: space.xs },
});
