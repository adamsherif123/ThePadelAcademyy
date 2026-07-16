import Ionicons from '@expo/vector-icons/Ionicons';
import { color, creditExpiry, radius, space } from '@tpa/theme';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text, type TextVariant } from './Text';
import type { IoniconName } from './trainingMeta';

export type InfoCardVariant = 'navy' | 'amber' | 'royal' | 'neutral' | 'success' | 'danger';
export type InfoCardSize = 'md' | 'sm';

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

interface SizeSpec {
  padV: number;
  padH: number;
  gap: number;
  text: TextVariant;
  icon: number;
  radius: number;
  border: number;
  align: 'center' | 'flex-start';
  iconTop: number;
}

const SIZE: Record<InfoCardSize, SizeSpec> = {
  // Page-level block: earns its weight — body copy, generous padding, full border.
  md: { padV: space.md, padH: space.md, gap: space.sm, text: 'body', icon: 18, radius: radius.md, border: 1, align: 'flex-start', iconTop: 1 },
  // Inline status strip living inside another card: a slim tinted bar — caption
  // copy, tight padding, small icon, hairline edge, centered on one line.
  sm: { padV: space.xs, padH: space.sm, gap: space.xs, text: 'caption', icon: 14, radius: radius.sm, border: StyleSheet.hairlineWidth, align: 'center', iconTop: 0 },
};

/**
 * A notice in one of six brand variants and two sizes. `md` (default) is a
 * page-level block; `sm` is a slim inline status strip for notices that live
 * INSIDE another card (Home's expiry strip, BookingCard's cancellation strips).
 *
 * Severity is carried by the variant's fg/bg TINT PAIR, not by the surface behind
 * it — so the same treatment reads correctly on both the navy hero and white cards
 * (the light-bg/dark-fg chip brings its own contrast). Icon + text row, text
 * colored to the variant. RTL-safe (leading icon via row + gap).
 */
export function InfoCard({
  text,
  variant = 'neutral',
  size = 'md',
  icon,
  onDismiss,
  style,
}: {
  text: string;
  variant?: InfoCardVariant;
  size?: InfoCardSize;
  icon?: IoniconName;
  /** When set, renders a labelled dismiss (X) at the end with a 44pt tap target. */
  onDismiss?: () => void;
  style?: ViewStyle;
}) {
  const v = VARIANT[variant];
  const s = SIZE[size];
  return (
    <View
      style={[
        styles.base,
        {
          paddingVertical: s.padV,
          paddingHorizontal: s.padH,
          gap: s.gap,
          alignItems: s.align,
          borderRadius: s.radius,
          borderWidth: s.border,
          backgroundColor: v.bg,
          borderColor: v.border,
        },
        style,
      ]}
    >
      <Ionicons name={icon ?? v.icon} size={s.icon} color={v.fg} style={{ marginTop: s.iconTop }} />
      <Text variant={s.text} style={[styles.text, { color: v.fg }]}>
        {text}
      </Text>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
        >
          <Ionicons name="close" size={16} color={v.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row' },
  text: { flex: 1 },
});
