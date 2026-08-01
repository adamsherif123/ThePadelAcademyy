import { TRAINING_TYPES, formatInstantTime, formatMonthDay } from '@tpa/core';
import type { BookingStatus, Player, TrainingType } from '@tpa/types';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { BookingRow } from '../data/bookingList';
import { useAdminData, useBookingsPage, useBookingStatusCounts } from '../data/queries';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import {
  Avatar,
  Button,
  ErrorView,
  LoadingView,
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

const PAGE_SIZE = 10;

/** Bookings route: count cards + filters + a server-paginated bookings table. */
export function Bookings() {
  const [queryText, setQueryText] = useState('');
  const [search, setSearch] = useState(''); // queryText, debounced
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Player | null>(null);

  // Debounce the search box ~300ms before it becomes a query param.
  useEffect(() => {
    const t = setTimeout(() => setSearch(queryText.trim()), 300);
    return () => clearTimeout(t);
  }, [queryText]);

  // A new search/status/type is a different filtered set — page 2 of the old set
  // is meaningless (and may not even exist) against the new one. Adjusted during
  // render (React's "reset state when a prop changes" pattern) rather than an
  // effect, so the stale page never flashes through a fetch before resetting.
  const [prevFilters, setPrevFilters] = useState({ search, status, type });
  if (prevFilters.search !== search || prevFilters.status !== status || prevFilters.type !== type) {
    setPrevFilters({ search, status, type });
    setPage(0);
  }

  const counts = useBookingStatusCounts();
  const bookingsPage = useBookingsPage({ page, pageSize: PAGE_SIZE, search, status, type });
  // PlayerDetailModal shows a player's FULL booking history, independent of this
  // page's slice/filters — it still needs the whole-table monolith.
  const modalData = useAdminData();

  const rows = bookingsPage.data?.rows ?? [];
  const total = bookingsPage.data?.total ?? 0;
  const rangeFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeTo = page * PAGE_SIZE + rows.length;
  const hasPrev = page > 0;
  const hasNext = rangeTo < total;
  const isFiltered = search !== '' || status !== 'all' || type !== 'all';

  const isPending = bookingsPage.isPending || counts.isPending || modalData.isPending;
  const isError = bookingsPage.isError || counts.isError || modalData.isError;
  if (isPending) return <LoadingView />;
  if (isError) {
    return (
      <ErrorView
        onRetry={() => {
          bookingsPage.refetch();
          counts.refetch();
          modalData.refetch();
        }}
      />
    );
  }

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
        <Count num={counts.data?.booked ?? 0} label="Booked" />
        <Count num={counts.data?.attended ?? 0} label="Attended" />
        <Count num={counts.data?.cancelled ?? 0} label="Cancelled" />
        <Count num={counts.data?.no_show ?? 0} label="No-show" />
      </div>

      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchInput value={queryText} onChange={setQueryText} placeholder="Search player…" />
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

      {rows.length === 0 ? (
        <div className={styles.tableWrap}>
          <p className={styles.empty}>{isFiltered ? 'No bookings match these filters.' : 'No bookings yet.'}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <Table columns={columns} rows={rows} keyOf={(r) => r.booking.id} />
        </div>
      )}

      <div className={styles.pagination}>
        <span className={styles.pageInfo}>
          {total === 0 ? 'No bookings' : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          {bookingsPage.isFetching ? <Loader2 size={14} className="tpa-spin" aria-hidden /> : null}
        </span>
        <div className={styles.pageControls}>
          <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" icon={ChevronRight} disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {selected ? (
        <PlayerDetailModal
          player={selected}
          batches={modalData.batches}
          purchases={modalData.purchases}
          bookings={modalData.bookings}
          slots={modalData.slots}
          coaches={modalData.coaches}
          packages={modalData.packages}
          onClose={() => setSelected(null)}
        />
      ) : null}
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
