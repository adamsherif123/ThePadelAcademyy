import { StyleSheet, View } from 'react-native';

import { Text } from '../ui/Text';

/**
 * Placeholder screen for the tab shell — a centered screen name via the shared
 * <Text>. (The S0 raw-<Text> escape hatch is gone as of S2.)
 */
export function PlaceholderScreen({ name }: { name: string }) {
  return (
    <View style={styles.container}>
      <Text variant="h1">{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
