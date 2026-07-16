import Ionicons from '@expo/vector-icons/Ionicons';
import { color, creditExpiry, radius, space } from '@tpa/theme';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

export type SuccessTone = 'success' | 'accent';

/**
 * The shared success-screen layout (booked / purchased): a colored icon circle,
 * periwinkle eyebrow, extrabold display heading, a detail card slot, then a
 * primary + optional secondary full-pill CTA. Establishes one look for every
 * confirmation screen. RTL-safe.
 */
export function SuccessView({
  icon = 'checkmark',
  tone = 'success',
  eyebrow,
  title,
  children,
  primary,
  secondary,
}: {
  icon?: IoniconName;
  tone?: SuccessTone;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  primary: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
}) {
  const circle = tone === 'success' ? creditExpiry.ok : { fg: color.accent.default, bg: color.bg.canvas };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={[styles.circle, { backgroundColor: circle.bg }]}>
          <Ionicons name={icon} size={44} color={circle.fg} />
        </View>
        <Text variant="label" style={styles.centered}>
          {eyebrow}
        </Text>
        <Text variant="display" style={styles.centered}>
          {title}
        </Text>
        {children ? <View style={styles.detail}>{children}</View> : null}
      </View>

      <View style={styles.actions}>
        <Button label={primary.label} onPress={primary.onPress} />
        {secondary ? (
          <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between' },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  circle: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  centered: { textAlign: 'center' },
  detail: { alignSelf: 'stretch', marginTop: space.lg },
  actions: { gap: space.sm },
});
