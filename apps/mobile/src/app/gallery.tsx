import { TRAINING_TYPES, type CreditExpiryState } from '@tpa/core';
import { MOCK_NOW, daysFromNow, egp } from '@tpa/mocks';
import { color, space, trainingTint } from '@tpa/theme';
import type { CreditBatch, TrainingType } from '@tpa/types';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CreditPill } from '../ui/CreditPill';
import { Input } from '../ui/Input';
import { Money } from '../ui/Money';
import { Text } from '../ui/Text';

/**
 * DEV-ONLY design-system gallery — every primitive in every state. Not a product
 * screen; reachable from a "Dev · Gallery" link on Home. This is the S2 sign-off
 * surface to eyeball on a device.
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

const EXPIRY_STATES: CreditExpiryState[] = ['ok', 'expiring_soon', 'expired'];

function demoBatch(trainingType: TrainingType, state: CreditExpiryState): CreditBatch {
  const expiresAt =
    state === 'expired' ? daysFromNow(-2) : state === 'expiring_soon' ? daysFromNow(2) : daysFromNow(20);
  const isTrial = trainingType === 'trial';
  return {
    id: `cb_${trainingType}_${state}` as CreditBatch['id'],
    playerId: 'pl_demo' as CreditBatch['playerId'],
    source: isTrial ? 'signup_grant' : 'purchase',
    purchaseId: isTrial ? null : ('pu_demo' as CreditBatch['purchaseId']),
    trainingType,
    quantityTotal: 4,
    quantityRemaining: state === 'expired' ? 4 : 2,
    createdAt: MOCK_NOW,
    expiresAt,
  };
}

export default function GalleryScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text variant="display">Gallery</Text>
      <Text variant="bodySecondary">Dev-only · every primitive & state</Text>

      <Section title="Text variants">
        <Text variant="display">Display</Text>
        <Text variant="h1">Heading 1</Text>
        <Text variant="h2">Heading 2</Text>
        <Text variant="body">Body — the quick brown fox.</Text>
        <Text variant="bodySecondary">Body secondary — supporting copy.</Text>
        <Text variant="label">Label periwinkle</Text>
        <Text variant="caption">Caption meta text</Text>
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
          <Button label="Secondary off" variant="secondary" disabled onPress={() => {}} />
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
          <Text variant="body" tone="inverse">
            Deep navy — hero / balance surface.
          </Text>
          <View style={styles.inlineRow}>
            <Badge label="On navy" tone="onInverse" />
            <Badge label="Members" tone="onInverse" />
          </View>
        </Card>
      </Section>

      <Section title="Inputs">
        <Input label="Default" placeholder="Tap to focus…" />
        <Input label="Error" placeholder="Phone" error="Enter a valid number." defaultValue="12" />
        <Input label="Disabled" placeholder="Unavailable" disabled defaultValue="Locked" />
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
            <Badge key={t} label={t} tint={trainingTint[t]} />
          ))}
        </Row>
      </Section>

      <Section title="Money">
        <Money amount={egp(500)} variant="h2" />
        <Money amount={egp(1600)} />
        <Money amount={egp(6000)} tone="accent" />
      </Section>

      <Section title="CreditPill — 4 training types × 3 expiry states">
        {TRAINING_TYPES.map((t) => (
          <View key={t} style={styles.pillRow}>
            {EXPIRY_STATES.map((state) => (
              <CreditPill key={state} batch={demoBatch(t, state)} now={MOCK_NOW} />
            ))}
          </View>
        ))}
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
  inlineRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  footer: { alignItems: 'center', paddingVertical: space.xl },
});
