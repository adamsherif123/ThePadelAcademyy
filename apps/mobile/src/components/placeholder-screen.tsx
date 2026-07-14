// eslint-disable-next-line no-restricted-imports -- S0 placeholder; replaced by the shared <Text> in S2.
import { StyleSheet, Text, View } from 'react-native';

/**
 * Session 0 scaffolding only. Renders a centered screen name and nothing else.
 * Deliberately no colors, tokens, or fonts.
 */
export function PlaceholderScreen({ name }: { name: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 24,
  },
});
