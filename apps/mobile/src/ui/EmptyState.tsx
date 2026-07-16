import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * A considered empty state: an icon in a soft circle, a title, a line of copy,
 * and an optional CTA. RTL-safe / tokens only.
 */
export function EmptyState({
  icon,
  title,
  message,
  cta,
}: {
  icon: IoniconName;
  title: string;
  message: string;
  cta?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.container}>
      <View style={styles.circle}>
        <Ionicons name={icon} size={32} color={color.text.muted} />
      </View>
      <Text variant="h2" style={styles.centered}>
        {title}
      </Text>
      <Text variant="bodySecondary" style={styles.centered}>
        {message}
      </Text>
      {cta ? (
        <View style={styles.cta}>
          <Button label={cta.label} onPress={cta.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  circle: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: color.bg.canvas,
    borderColor: color.border.subtle,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  cta: { marginTop: space.sm, alignSelf: 'stretch' },
});
