import { TRAINING_TYPES, formatInstantTime, formatMonthDay } from '@tpa/core';
import type { BookingStatus, Player, TrainingType } from '@tpa/types';
import { useMemo, useState } from 'react';

import { bookingRows, bookingStatusCounts, type BookingRow } from '../data/bookingList';
import { useAdminStore } from '../data/store';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import {
  Avatar,
  PageHeader,
  SearchInput,
  Select,
  StatusChip,
  Table,
  TRAINING_LABEL,
  TypePill,
  type Column,
} from '../ui';
import styles from './Bookings.module.css';

type StatusFilter = BookingStatus | 'all';
type TypeFilter = TrainingType | 'all';

const STATUS_LABEL: Record<BookingStatus, string> = {
  booked: 'Booked',
  attended: 'Attended',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

/** Bookings route: count cards + filters + the all-bookings table. */
export function Bookings() {
  useAdminStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [selected, setSelected] = useState<Player | null>(null);

  const counts = bookingStatusCounts();
  const rows = bookingRows();
  const anyBookings = rows.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.booking.status !== status) return false;
      if (type !== 'all' && r.slot?.trainingType !== type) return false;
      if (q === '') return true;
      return (r.player?.name.toLowerCase().includes(q) ?? false) || (r.coach?.name.toLowerCase().includes(q) ?? false);
    });
  }, [rows, query, status, type]);

  const columns: Column<BookingRow>[] = [
    {
      key: 'player',
      header: 'Player',
      render: (r) => (
        <button type="button" className={styles.playerCell} onClick={() => r.player && setSelected(r.player)}>
          <Avatar name={r.player?.name ?? 'Player'} size={32} />
          {r.player?.name ?? 'Unknown player'}
        </button>
      ),
    },
    {
      key: 'session',
      header: 'Session',
      render: (r) => (r.slot ? <TypePill type={r.slot.trainingType} /> : <span className={styles.muted}>—</span>),
    },
    { key: 'coach', header: 'Coach', render: (r) => <span className={styles.muted}>{r.coach?.name ?? '—'}</span> },
    {
      key: 'date',
      header: 'Date',
      render: (r) =>
        r.slot ? (
          <span className={styles.muted}>
            {formatMonthDay(r.slot.startsAt)} · {formatInstantTime(r.slot.startsAt)}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.booking.status} /> },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Activity"
        title="Bookings"
        subtitle="Every seat booked across all sessions. Track attendance, no-shows and cancellations, and jump to any player."
      />

      <div className={styles.counts}>
        <Count num={counts.booked} label="Booked" />
        <Count num={counts.attended} label="Attended" />
        <Count num={counts.cancelled} label="Cancelled" />
        <Count num={counts.no_show} label="No-show" />
      </div>

      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search player or coach…" />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          options={[
            { value: 'all', label: 'All statuses' },
            ...(['booked', 'attended', 'cancelled', 'no_show'] as BookingStatus[]).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          ]}
        />
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as TypeFilter)}
          options={[
            { value: 'all', label: 'All types' },
            ...TRAINING_TYPES.map((t) => ({ value: t, label: TRAINING_LABEL[t] })),
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={styles.empty}>
            {anyBookings ? 'No bookings match these filters.' : 'No bookings yet.'}
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <Table columns={columns} rows={filtered} keyOf={(r) => r.booking.id} />
        </div>
      )}

      {selected ? <PlayerDetailModal player={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function Count({ num, label }: { num: number; label: string }) {
  return (
    <div className={styles.countCard}>
      <span className={styles.countNum}>{num}</span>
      <span className={styles.countLabel}>{label}</span>
    </div>
  );
}
