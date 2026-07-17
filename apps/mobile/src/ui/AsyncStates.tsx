import { color, space } from '@tpa/theme';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EmptyState } from './EmptyState';
import { Text } from './Text';

/**
 * The two states every remote screen must show now that data is async: a bounded
 * spinner while loading, and a real error with a Retry — never an endless spinner.
 * A transport failure (offline, timeout, 5xx) lands here; retry re-runs the query.
 */
export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar">
      <ActivityIndicator color={color.accent.default} />
      {label ? (
        <Text variant="bodySecondary" style={styles.label}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorView({
  onRetry,
  title = 'Something went wrong',
  message = "We couldn't reach the academy. Check your connection and try again.",
}: {
  onRetry: () => void;
  title?: string;
  message?: string;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      message={message}
      cta={{ label: 'Try again', onPress: onRetry }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xxxl },
  label: { textAlign: 'center' },
});
