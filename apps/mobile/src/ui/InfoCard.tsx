import Ionicons from '@expo/vector-icons/Ionicons';
import { color, creditExpiry, radius, space } from '@tpa/theme';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

export type InfoCardVariant = 'navy' | 'amber' | 'royal' | 'neutral' | 'success' | 'danger';

interface VariantStyle {
  bg: string;
  border: string;
  fg: string;
  icon: IoniconName;
}

const VARIANT: Record<InfoCardVariant, VariantStyle> = {
  // Informational, deep navy.
  navy: { bg: color.bg.inverse, border: color.border.onInverse, fg: color.text.inverse, icon: 'information-circle-outline' },
  // Expiry warnings (amber creditExpiry tokens).
  amber: { bg: creditExpiry.expiring_soon.bg, border: creditExpiry.expiring_soon.bg, fg: creditExpiry.expiring_soon.fg, icon: 'time-outline' },
  // "This will use 1 credit" callout — white with a royal border.
  royal: { bg: color.bg.surface, border: color.accent.default, fg: color.accent.default, icon: 'ticket-outline' },
  // Subtle neutral note (profile-setup explainer).
  neutral: { bg: color.bg.surface, border: color.border.subtle, fg: color.text.secondary, icon: 'information-circle-outline' },
  // Green "free cancellation" strip (ok creditExpiry tokens).
  success: { bg: creditExpiry.ok.bg, border: creditExpiry.ok.bg, fg: creditExpiry.ok.fg, icon: 'checkmark-circle-outline' },
  // Red forfeit warning (expired creditExpiry tokens).
  danger: { bg: creditExpiry.expired.bg, border: creditExpiry.expired.bg, fg: creditExpiry.expired.fg, icon: 'alert-circle-outline' },
};

/**
 * Informational card in one of four brand variants. Icon + text row; the text
 * color matches the variant. RTL-safe (leading icon via row + gap).
 */
export function InfoCard({
  text,
  variant = 'neutral',
  icon,
  style,
}: {
  text: string;
  variant?: InfoCardVariant;
  icon?: IoniconName;
  style?: ViewStyle;
}) {
  const v = VARIANT[variant];
  return (
    <View style={[styles.base, { backgroundColor: v.bg, borderColor: v.border }, style]}>
      <Ionicons name={icon ?? v.icon} size={18} color={v.fg} style={styles.icon} />
      <Text variant="body" style={[styles.text, { color: v.fg }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  icon: { marginTop: 1 },
  text: { flex: 1 },
});
