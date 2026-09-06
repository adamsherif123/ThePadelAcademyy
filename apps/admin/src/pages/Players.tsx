import { LEVELS } from '@tpa/core';
import type { Level, Player } from '@tpa/types';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { creditBreakdown } from '../data/players';
import { useAdminData, usePlayersPage } from '../data/queries';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import { useSession } from '../session/SessionProvider';
import {
  Avatar,
  Badge,
  Button,
  ErrorView,
  GENDER_LABEL,
  LEVEL_LABEL,
  LoadingView,
  PageHeader,
  SearchInput,
  SegmentedTabs,
  Select,
} from '../ui';
import styles from './Players.module.css';

type GenderFilter = 'all' | 'men' | 'ladies';

const PAGE_SIZE = 10;

/**
 * Players route: search + gender/level filters over the roster, opening detail.
 *
 * The roster is SERVER-paginated (10/page) — it does not slice useAdminData's
 * whole-table blob, which doesn't scale as the academy grows. Search and both filters
 * run in that same bounded query, so they reach every player rather than only the ten
 * currently on screen. useAdminData is still read here, but ONLY for what
 * PlayerDetailModal needs (a player's full history), never for the list.
 */
export function Players() {
  const { now } = useSession();
  const [queryText, setQueryText] = useState('');
  const [search, setSearch] = useState(''); // queryText, debounced
  const [gender, setGender] = useState<GenderFilter>('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Player | null>(null);

  // Debounce the search box ~300ms before it becomes a query param (mirrors Bookings).
  useEffect(() => {
    const t = setTimeout(() => setSearch(queryText.trim()), 300);
    return () => clearTimeout(t);
  }, [queryText]);

  // A new search/filter is a different result set — page 3 of the old one is
  // meaningless against it (and may not exist). Adjusted during render, so the stale
  // page never flashes through a fetch before resetting.
  const [prevFilters, setPrevFilters] = useState({ search, gender, level });
  if (prevFilters.search !== search || prevFilters.gender !== gender || prevFilters.level !== level) {
    setPrevFilters({ search, gender, level });
    setPage(0);
  }

  const playersPage = usePlayersPage({ page, pageSize: PAGE_SIZE, search, gender, level });
  // PlayerDetailModal shows a player's FULL history (batches, purchases, bookings,
  // slots) — that still needs the monolith, which every other admin page also reads.
  const modalData = useAdminData();

  const rows = playersPage.data?.rows ?? [];
  const total = playersPage.data?.total ?? 0;
  const rangeFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeTo = page * PAGE_SIZE + rows.length;
  const hasPrev = page > 0;
  const hasNext = rangeTo < total;
  const isFiltered = search !== '' || gender !== 'all' || level !== 'all';

  if (playersPage.isPending || modalData.isPending) return <LoadingView />;
  if (playersPage.isError || modalData.isError) {
    return (
      <ErrorView
        onRetry={() => {
          playersPage.refetch();
          modalData.refetch();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Members"
        title="Players"
        subtitle="Every registered player, their level, and their live credit balance across group, duo, and individual training."
      />

      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchInput value={queryText} onChange={setQueryText} placeholder="Search name, phone or email" />
        </div>
        <div className={styles.filterEnd}>
          <SegmentedTabs
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'men', label: 'Men' },
              { value: 'ladies', label: 'Ladies' },
            ]}
            value={gender}
            onChange={setGender}
          />
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value as Level | 'all')}
            options={[{ value: 'all', label: 'All levels' }, ...LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.list}>
          <p className={styles.empty}>
            {isFiltered ? 'No players match these filters.' : 'No players yet.'}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {rows.map(({ player, batches }) => {
            const bd = creditBreakdown(batches, player.id, now);
            return (
              <button
                key={player.id}
                type="button"
                className={styles.row}
                onClick={() => setSelected(player)}
              >
                <Avatar name={player.name} size={40} />
                <div className={styles.info}>
                  <span className={styles.name}>{player.name}</span>
                  <span className={styles.phone}>{player.phone ?? 'No phone'}</span>
                </div>
                <div className={styles.pills}>
                  <Badge tone="neutral">{GENDER_LABEL[player.gender]}</Badge>
                  <Badge tone="neutral">{LEVEL_LABEL[player.level]}</Badge>
                </div>
                <div className={styles.credits}>
                  <span className={styles.creditsTotal}>
                    {bd.total} credit{bd.total === 1 ? '' : 's'}
                  </span>
                  <span className={styles.creditsBreak}>
                    G {bd.group} · D {bd.duo} · I {bd.individual}
                  </span>
                </div>
                <ChevronRight className={styles.chevron} size={18} aria-hidden />
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.pagination}>
        <span className={styles.pageInfo}>
          {total === 0 ? 'No players' : `Showing ${rangeFrom}–${rangeTo} of ${total}`}
          {playersPage.isFetching ? <Loader2 size={14} className="tpa-spin" aria-hidden /> : null}
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
