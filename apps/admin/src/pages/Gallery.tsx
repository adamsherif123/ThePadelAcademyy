import type { Coach, CoachId, IsoInstant, Piastres, Player, PlayerId, SessionSlot, SlotId } from '@tpa/types';
import { DollarSign, Gauge, Plus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { EventCard } from '../calendar/EventCard';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Donut,
  EmptyState,
  Input,
  LineChart,
  Modal,
  PageHeader,
  Panel,
  PlayerSearch,
  SearchInput,
  SegmentedTabs,
  Select,
  StatCard,
  StatusChip,
  Table,
  Toggle,
  TypePill,
  type Column,
  type DonutSegment,
} from '../ui';
import styles from './Gallery.module.css';

const egp = (n: number) => (n * 100) as Piastres;

/** A realistic worst-case card: long coach name + long tags + 0/4 capacity. */
const DEMO_SLOT: SessionSlot = {
  id: 'sl_demo' as SlotId,
  coachId: 'co_mariam' as CoachId, // → "Mariam"
  startsAt: '2026-07-19T15:00:00.000Z' as SessionSlot['startsAt'], // 6 PM Cairo
  endsAt: '2026-07-19T17:00:00.000Z' as SessionSlot['startsAt'], // 8 PM Cairo
  manuallyConfirmedAt: null,
  trainingType: 'group',
  capacity: 4,
  bookedCount: 0,
  gender: 'ladies',
  level: 'intermediate',
  status: 'published',
  templateId: null,
};

/** Self-contained fixtures so the dev gallery renders without live data. */
const DEMO_COACH: Coach = {
  id: 'co_mariam' as CoachId,
  name: 'Mariam Hassan',
  bio: 'Group and ladies-only specialist.',
  photoUrl: null,
  isActive: true,
};

const DEMO_PLAYERS: Player[] = [
  { id: 'pl_rania' as PlayerId, name: 'Rania Adham', phone: '+20 100 111 2222', gender: 'ladies', level: 'intermediate', createdAt: '2026-01-04T09:00:00.000Z' as IsoInstant },
  { id: 'pl_karim' as PlayerId, name: 'Karim Adel', phone: '+20 100 333 4444', gender: 'men', level: 'beginner', createdAt: '2026-02-11T09:00:00.000Z' as IsoInstant },
  { id: 'pl_nour' as PlayerId, name: 'Nour El-Sayed', phone: '+20 100 555 6666', gender: 'ladies', level: 'adv_beginner', createdAt: '2026-03-20T09:00:00.000Z' as IsoInstant },
  { id: 'pl_hany' as PlayerId, name: 'Hany Farouk', phone: '+20 100 777 8888', gender: 'men', level: 'intermediate', createdAt: '2026-04-02T09:00:00.000Z' as IsoInstant },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.row}>{children}</div>
    </section>
  );
}

interface PlayerRow {
  id: string;
  name: string;
  phone: string;
}

/** DEV-ONLY design-system gallery — every admin primitive in its states. */
export function Gallery() {
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  const [sellable, setSellable] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const coach = DEMO_COACH;
  const players = DEMO_PLAYERS.slice(0, 4);
  const columns: readonly Column<PlayerRow>[] = [
    {
      key: 'player',
      header: 'Player',
      render: (p) => (
        <span className={styles.cellPlayer}>
          <Avatar name={p.name} size={32} />
          {p.name}
        </span>
      ),
    },
    { key: 'phone', header: 'Phone', render: (p) => p.phone },
    { key: 'type', header: 'Session', render: () => <TypePill type="group" /> },
    { key: 'status', header: 'Status', align: 'end', render: () => <StatusChip status="booked" /> },
  ];
  const rows: PlayerRow[] = players.map((p) => ({ id: p.id, name: p.name, phone: p.phone ?? '—' }));

  return (
    <div>
      <PageHeader eyebrow="Dev only" title="Gallery" subtitle="Every admin primitive, in every state." />

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Cancel session</Button>
        <Button icon={Plus}>Add one-off slot</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Badge tones">
        <Badge tone="success">Active</Badge>
        <Badge tone="warning">On leave</Badge>
        <Badge tone="neutral">Paused</Badge>
        <Badge tone="info">Booked</Badge>
        <Badge tone="danger">Cancelled</Badge>
      </Section>

      <Section title="StatusChip (booking status)">
        <StatusChip status="booked" />
        <StatusChip status="attended" />
        <StatusChip status="cancelled" />
        <StatusChip status="no_show" />
      </Section>

      <Section title="TypePill (admin trainingTint)">
        <TypePill type="group" />
        <TypePill type="duo" />
        <TypePill type="individual" />
        <TypePill type="trial" />
      </Section>

      <Section title="Avatar (photo + initials fallback)">
        {coach ? <Avatar name={coach.name} photoUrl={coach.photoUrl} size={48} /> : null}
        <Avatar name="Rania Adham" size={48} />
        <Avatar name="Karim Adel" size={48} />
        <Avatar name="Nour El-Sayed" photoUrl="https://invalid.example/x.jpg" size={48} />
      </Section>

      <Section title="Toggle">
        <Toggle checked={sellable} onChange={setSellable} label="Sellable" />
        <span>{sellable ? 'Sellable' : 'Hidden'}</span>
      </Section>

      <Section title="SegmentedTabs">
        <SegmentedTabs
          tabs={[
            { value: 'calendar', label: 'Week calendar' },
            { value: 'templates', label: 'Recurring sessions' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Section>

      <Section title="Inputs">
        <Input label="Coach" defaultValue="Hany Farouk" />
        <Input label="Capacity" type="number" defaultValue={4} hint="Group: 3–4 players" />
        <Select
          label="Level"
          options={[
            { value: 'all', label: 'All levels' },
            { value: 'beginner', label: 'Beginner' },
            { value: 'intermediate', label: 'Intermediate' },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search player or coach…" />
      </Section>

      <Section title="Card + Table">
        <Card className={styles.tableCard}>
          <Table columns={columns} rows={rows} keyOf={(r) => r.id} />
        </Card>
      </Section>

      <Section title="Modal">
        <Button onClick={() => setOpen(true)}>Open slot detail</Button>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          eyebrow="Monday, July 20 · 6 PM–8 PM"
          title="Group session"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button onClick={() => setOpen(false)}>Save changes</Button>
            </>
          }
        >
          <p>2 of 4 booked · coached by Hany Farouk.</p>
        </Modal>
      </Section>

      <Section title="EmptyState">
        <Card className={styles.tableCard}>
          <EmptyState
            icon={Plus}
            title="No sessions scheduled"
            message="Add a one-off slot or generate this week from your recurring sessions."
            action={<Button icon={Plus}>Add one-off slot</Button>}
          />
        </Card>
      </Section>

      <Section title="StatCard (KPI)">
        <StatCard eyebrow="Revenue · July" icon={DollarSign} iconTone="accent" value="113,700 EGP" delta={-43} caption="vs last month" />
        <StatCard eyebrow="Active players" icon={Users} value="101" caption="with credits or bookings" />
        <StatCard eyebrow="Slot fill rate" icon={Gauge} value="48%" delta={12} caption="capacity booked this week" />
      </Section>

      <Section title="LineChart (revenue over time)">
        <Panel eyebrow="Last 8 weeks" title="Revenue over time">
          <LineChart
            data={[
              { label: '31/5', value: egp(0) },
              { label: '7/6', value: egp(48000) },
              { label: '14/6', value: egp(63000) },
              { label: '21/6', value: egp(48000) },
              { label: '28/6', value: egp(60000) },
              { label: '5/7', value: egp(43000) },
              { label: '12/7', value: egp(45000) },
              { label: '19/7', value: egp(6000) },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Donut — realistic, and STRESS at 6-digit figures (legend must fit)">
        <div className={styles.donutGrid}>
          <Panel eyebrow="What earns" title="Revenue by training type">
            <Donut segments={DONUT_REALISTIC} total={egp(313800)} />
          </Panel>
          <Panel eyebrow="Stress test" title="Largest plausible figures">
            <Donut segments={DONUT_STRESS} total={egp(2799997)} />
          </Panel>
        </div>
      </Section>

      <Section title="Calendar EventCard — 1 / 2 / 3 lanes (drop order: tags → coach; capacity never truncates)">
        {[
          { lanes: 1, w: 150 },
          { lanes: 2, w: 74 },
          { lanes: 3, w: 49 },
        ].map(({ lanes, w }) => (
          <div key={lanes} className={styles.eventDemo} style={{ width: w }}>
            <EventCard
              slot={DEMO_SLOT}
              lanes={lanes}
              style={{ top: 0, height: 108, insetInlineStart: 0, width: '100%' }}
              onClick={() => {}}
            />
          </div>
        ))}
      </Section>

      <Section title="PlayerSearch (reusable — search name/phone, trailing slot per row)">
        <div className={styles.pickerDemo}>
          <PlayerSearch
            players={DEMO_PLAYERS}
            renderTrailing={(p) => (
              <Button size="sm" variant="secondary">
                {p.gender === 'men' ? "Men's" : "Ladies'"}
              </Button>
            )}
          />
        </div>
      </Section>
    </div>
  );
}

const DONUT_REALISTIC: DonutSegment[] = [
  { key: 'group', label: 'Group', value: egp(86000), color: 'var(--tint-group-fg)' },
  { key: 'duo', label: 'Duo', value: egp(139000), color: 'var(--tint-duo-fg)' },
  { key: 'individual', label: 'Individual', value: egp(88800), color: 'var(--color-text-label)' },
];

// Six-digit EGP + percentages: the case v0's legend overflowed on.
const DONUT_STRESS: DonutSegment[] = [
  { key: 'group', label: 'Group', value: egp(999999), color: 'var(--tint-group-fg)' },
  { key: 'duo', label: 'Duo', value: egp(899999), color: 'var(--tint-duo-fg)' },
  { key: 'individual', label: 'Individual', value: egp(899999), color: 'var(--color-text-label)' },
];
