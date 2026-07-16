import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { allCoaches, allPlayers } from '../data/selectors';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  SegmentedTabs,
  Select,
  StatusChip,
  Table,
  Toggle,
  TypePill,
  type Column,
} from '../ui';
import styles from './Gallery.module.css';

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

  const coach = allCoaches()[0];
  const players = allPlayers().slice(0, 4);
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
  const rows: PlayerRow[] = players.map((p) => ({ id: p.id, name: p.name, phone: p.phone }));

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
            { value: 'templates', label: 'Availability templates' },
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
            message="Add a one-off slot or generate this week from the availability templates."
            action={<Button icon={Plus}>Add one-off slot</Button>}
          />
        </Card>
      </Section>
    </div>
  );
}
