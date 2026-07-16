import { TRAINING_TYPES } from '@tpa/core';
import { MOCK_NOW, daysFromNow, egp, mockCoaches, mockCreditBatches, mockPackages, mockSlots } from '@tpa/mocks';
import { color, radius, space } from '@tpa/theme';
import type { IsoInstant, SessionSlot } from '@tpa/types';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  AcademyCard,
  Avatar,
  Badge,
  Button,
  CapacityDots,
  Card,
  CheckList,
  CreditsSummaryCard,
  DateChip,
  EmptyState,
  IconRow,
  InfoCard,
  Input,
  LinkRow,
  Money,
  PackageCard,
  PackageRow,
  PillOnNavy,
  ProgressBar,
  ScreenHeader,
  SegmentedControl,
  SlotCard,
  type SlotCardState,
  StatusChip,
  SuccessView,
  Text,
  TRAINING_META,
  TypeCard,
} from '../ui';

const DEMO_SLOT: SessionSlot | undefined = mockSlots.find(
  (s) => s.trainingType === 'group' && s.gender === 'men',
);
const DEMO_COACH = mockCoaches[0];
const SLOT_STATES: { state: SlotCardState; note?: string; creditNote?: string }[] = [
  { state: 'bookable', creditNote: 'Uses 1 Group credit' },
  { state: 'full' },
  { state: 'booked' },
  { state: 'unavailable', note: 'Ladies only' },
  { state: 'unavailable', note: 'Intermediate level' },
  { state: 'unavailable', note: 'Credits expired' },
  { state: 'unavailable', note: 'No credits' },
];

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
        <Text variant="micro">Micro tile label</Text>
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

      <Section title="CreditsSummaryCard">
        <CreditsSummaryCard
          total={13}
          balance={{ trial: 2, group: 7, duo: 0, individual: 4 }}
          eyebrow="Your credits"
          action={{ label: 'Wallet', trailingIcon: 'arrow-forward', onPress: () => {} }}
          expiringText="2 Group credits — expires in 2 days"
        />
      </Section>

      <Section title="LinkRow">
        <LinkRow icon="wallet-outline" title="Wallet" subtitle="13 usable credits" onPress={() => {}} />
        <LinkRow icon="receipt-outline" title="Purchase history" subtitle="6 purchases" onPress={() => {}} />
      </Section>

      <Section title="PackageRow (buy-credits row)">
        {mockPackages
          .filter((p) => p.trainingType === 'group')
          .map((p) => (
            <PackageRow key={p.id} pkg={p} onPress={() => {}} />
          ))}
      </Section>

      <Section title="PackageCard (home carousel — teaser, no BEST VALUE badge)">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardScroll}>
          {mockPackages
            .filter((p) => p.trainingType === 'group')
            .map((p) => (
              <PackageCard key={p.id} pkg={p} onPress={() => {}} />
            ))}
        </ScrollView>
      </Section>

      <Section title="Book — TypeCard (selector grid)">
        <View style={styles.typeRow}>
          <TypeCard trainingType="group" subtitle="3–4 players" credits={6} selected onPress={() => {}} />
          <TypeCard trainingType="individual" subtitle="1-on-1 coaching" credits={0} onPress={() => {}} />
        </View>
      </Section>

      <Section title="Book — DateChip (open / selected / closed)">
        <View style={styles.dateRow}>
          <DateChip weekday={3} dayNumber={15} selected onPress={() => {}} />
          <DateChip weekday={0} dayNumber={19} onPress={() => {}} />
          <DateChip weekday={4} dayNumber={16} closed />
        </View>
      </Section>

      <Section title="Book — CapacityDots">
        <CapacityDots booked={1} capacity={4} />
        <CapacityDots booked={4} capacity={4} muted />
      </Section>

      <Section title="Book — SlotCard (every availability state)">
        {DEMO_SLOT
          ? SLOT_STATES.map((s, i) => (
              <SlotCard
                key={i}
                slot={DEMO_SLOT}
                coach={DEMO_COACH}
                now={MOCK_NOW}
                state={s.state}
                note={s.note}
                creditNote={s.creditNote}
                onPress={s.state === 'bookable' ? () => {} : undefined}
              />
            ))
          : null}
      </Section>

      <Section title="CheckList">
        <Card>
          <CheckList items={['4 × Duo training sessions', 'Certified academy coaches', '1 credit = 1 session']} />
        </Card>
      </Section>

      <Section title="AcademyCard">
        <AcademyCard />
      </Section>

      <Section title="Button — icon + destructive">
        <Button label="Sign out" variant="secondary" destructive icon="log-out-outline" onPress={() => {}} />
      </Section>

      <Section title="SuccessView (booked / purchased pattern)">
        <View style={styles.successBox}>
          <SuccessView
            eyebrow="Payment confirmed"
            title="Credits added"
            primary={{ label: 'Go to Wallet', onPress: () => {} }}
            secondary={{ label: 'Done', onPress: () => {} }}
          >
            <Card>
              <Text variant="body">8 Group credits added · expires in 30 days</Text>
            </Card>
          </SuccessView>
        </View>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          icon="receipt-outline"
          title="No purchases yet"
          message="When you buy a credit bundle, it'll show up here."
          cta={{ label: 'Buy credits', onPress: () => {} }}
        />
      </Section>

      <View style={styles.footer}>
        <Text variant="caption">End of gallery — batches in mocks: {String(mockCreditBatches.length)}</Text>
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
  successBox: { height: 420 },
  cardScroll: { gap: space.md, paddingVertical: space.xs },
  typeRow: { flexDirection: 'row', gap: space.md },
  dateRow: { flexDirection: 'row', gap: space.sm },
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
