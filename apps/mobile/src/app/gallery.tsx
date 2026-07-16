import { TRAINING_TYPES } from '@tpa/core';
import { MOCK_NOW, daysFromNow, egp } from '@tpa/mocks';
import { color, radius, space } from '@tpa/theme';
import type { IsoInstant } from '@tpa/types';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  IconRow,
  InfoCard,
  Input,
  Money,
  PillOnNavy,
  ProgressBar,
  ScreenHeader,
  SegmentedControl,
  StatusChip,
  Text,
  TRAINING_META,
} from '../ui';

/**
 * DEV-ONLY design-system gallery — every primitive in every state. Not a product
 * screen; reachable from a "Dev · Gallery" link on Home. S2 base primitives plus
 * the S3a additions (ScreenHeader, NavyScreen split, Avatar, StatusChip,
 * ProgressBar, InfoCard, IconRow, SegmentedControl, PillOnNavy).
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="label">{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const EXPIRY_SAMPLES: { label: string; expiresAt: IsoInstant }[] = [
  { label: 'ok', expiresAt: daysFromNow(20) },
  { label: 'expiring_soon', expiresAt: daysFromNow(2) },
  { label: 'expired', expiresAt: daysFromNow(-7) },
];

const RADII = [
  { key: 'sm', value: radius.sm },
  { key: 'md', value: radius.md },
  { key: 'lg', value: radius.lg },
  { key: 'xl', value: radius.xl },
  { key: 'pill', value: radius.pill },
] as const;

export default function GalleryScreen() {
  const [segment, setSegment] = useState<'upcoming' | 'past'>('upcoming');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Dev only" title="Gallery" />

      <Section title="Text variants">
        <Text variant="display">Display</Text>
        <Text variant="h1">Heading 1</Text>
        <Text variant="h2">Heading 2</Text>
        <Text variant="body">Body — the quick brown fox.</Text>
        <Text variant="bodySecondary">Body secondary — supporting copy.</Text>
        <Text variant="label">Label periwinkle</Text>
        <Text variant="caption">Caption meta text</Text>
      </Section>

      <Section title="Shape — radius scale (from the app design)">
        <View style={styles.swatchRow}>
          {RADII.map((r) => (
            <View key={r.key} style={styles.swatchItem}>
              <View style={[styles.swatch, { borderRadius: r.value }]} />
              <Text variant="caption" tone="muted">{`${r.key} ${r.value === radius.pill ? 'pill' : r.value}`}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="ScreenHeader (light / navy / with back)">
        <ScreenHeader eyebrow="Wallet" title="Your Credits" onBack={() => {}} />
        <View style={styles.navyBox}>
          <ScreenHeader eyebrow="Verification" title="Enter the Code" onBack={() => {}} tone="navy" />
        </View>
      </Section>

      <Section title="Buttons">
        <Row>
          <Button label="Primary" onPress={() => {}} />
          <Button label="Secondary" variant="secondary" onPress={() => {}} />
          <Button label="Ghost" variant="ghost" onPress={() => {}} />
        </Row>
        <Row>
          <Button label="Disabled" disabled onPress={() => {}} />
          <Button label="Loading" loading onPress={() => {}} />
        </Row>
      </Section>

      <Section title="Avatar">
        <Row>
          <Avatar name="Adam Sherif" />
          <Avatar name="Mariam Fouad" size={56} />
          <Avatar name="Coach" imageUrl="https://placehold.co/100x100" size={56} />
        </Row>
      </Section>

      <Section title="Cards">
        <Card>
          <Text variant="h2">Surface card</Text>
          <Text variant="bodySecondary">White surface, subtle border, elevation.</Text>
        </Card>
        <Card variant="inverse">
          <Text variant="h2" tone="inverse">
            Inverse card
          </Text>
          <View style={styles.inlineRow}>
            {TRAINING_TYPES.map((t) => (
              <PillOnNavy key={t} label={TRAINING_META[t].label} icon={TRAINING_META[t].icon} />
            ))}
          </View>
          <View style={styles.inlineRow}>
            <PillOnNavy label="0 Individual" icon="person-outline" dimmed />
            <PillOnNavy label="Wallet" icon="wallet-outline" trailingIcon="arrow-forward" />
          </View>
        </Card>
      </Section>

      <Section title="InfoCard variants">
        <InfoCard variant="navy" text="Informational note on a navy surface." />
        <InfoCard variant="amber" text="2 Group credits — expires in 2 days." />
        <InfoCard variant="royal" text="Booking this session will use 1 Group credit." />
        <InfoCard variant="neutral" text="Men's and ladies' groups train separately, placed by level." />
      </Section>

      <Section title="Inputs">
        <Input label="Default" placeholder="Tap to focus…" />
        <Input label="Error" placeholder="Phone" error="Enter a valid number." defaultValue="12" />
        <Input label="Disabled" placeholder="Unavailable" disabled defaultValue="Locked" />
      </Section>

      <Section title="StatusChip (expiry states)">
        <Row>
          {EXPIRY_SAMPLES.map((s) => (
            <StatusChip key={s.label} expiresAt={s.expiresAt} now={MOCK_NOW} />
          ))}
        </Row>
      </Section>

      <Section title="ProgressBar">
        <ProgressBar value={0.25} />
        <ProgressBar value={0.75} />
        <ProgressBar value={0.5} tone="muted" />
      </Section>

      <Section title="SegmentedControl">
        <SegmentedControl
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </Section>

      <Section title="IconRow">
        <Card>
          <IconRow icon="location-outline" title="Oro Plaza Hotel" subtitle="In front of Family Park, Rehab, Cairo" />
          <View style={styles.spacer} />
          <IconRow icon="time-outline" title="Sun – Wed · 5:00 PM – 11:00 PM" subtitle="Group training mainly 5 – 9 PM" />
        </Card>
      </Section>

      <Section title="Badges">
        <Row>
          <Badge label="Neutral" />
          <Badge label="Success" tone="success" />
          <Badge label="Warning" tone="warning" />
          <Badge label="Danger" tone="danger" />
        </Row>
        <Row>
          {TRAINING_TYPES.map((t) => (
            <Badge key={t} label={TRAINING_META[t].label} />
          ))}
        </Row>
      </Section>

      <Section title="Money">
        <Money amount={egp(500)} variant="h2" />
        <Money amount={egp(1600)} />
        <Money amount={egp(6000)} tone="accent" />
      </Section>

      <View style={styles.footer}>
        <Text variant="caption">End of gallery</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg.canvas },
  content: { padding: space.xl, gap: space.xxl },
  section: { gap: space.md },
  sectionBody: { gap: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'center' },
  inlineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  navyBox: { backgroundColor: color.bg.inverse, borderRadius: radius.lg, padding: space.lg },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatchItem: { alignItems: 'center', gap: space.xs },
  swatch: {
    width: 56,
    height: 56,
    backgroundColor: color.bg.inverse,
    borderWidth: 1,
    borderColor: color.border.subtle,
  },
  spacer: { height: space.md },
  footer: { alignItems: 'center', paddingVertical: space.xl },
});
