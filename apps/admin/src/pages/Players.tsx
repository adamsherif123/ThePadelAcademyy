import { LEVELS } from '@tpa/core';
import type { Level, Player } from '@tpa/types';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { creditBreakdown } from '../data/players';
import { useAdminData } from '../data/queries';
import { PlayerDetailModal } from '../players/PlayerDetailModal';
import { useSession } from '../session/SessionProvider';
import {
  Avatar,
  Badge,
  ErrorView,
  GENDER_LABEL,
  LEVEL_LABEL,
  LoadingView,
  matchesPlayerQuery,
  PageHeader,
  SearchInput,
  SegmentedTabs,
  Select,
} from '../ui';
import styles from './Players.module.css';

type GenderFilter = 'all' | 'men' | 'ladies';

/** Players route: search + gender/level filters over the roster, opening detail. */
export function Players() {
  const { now } = useSession();
  const data = useAdminData();
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [selected, setSelected] = useState<Player | null>(null);

  const players = data.players;
  const filtered = useMemo(
    () =>
      players.filter(
        (p) =>
          matchesPlayerQuery(p, query) &&
          (gender === 'all' || p.gender === gender) &&
          (level === 'all' || p.level === level),
      ),
    [players, query, gender, level],
  );

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  return (
    <div>
      <PageHeader
        eyebrow="Members"
        title="Players"
        subtitle="Every registered player, their level, and their live credit balance across group, duo, and individual training."
      />

      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search name or phone" />
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

      <p className={styles.count}>
        {filtered.length} player{filtered.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className={styles.list}>
          <p className={styles.empty}>No players match these filters.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.map((p) => {
            const bd = creditBreakdown(data.batches, p.id, now);
            return (
              <button key={p.id} type="button" className={styles.row} onClick={() => setSelected(p)}>
                <Avatar name={p.name} size={40} />
                <div className={styles.info}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.phone}>{p.phone}</span>
                </div>
                <div className={styles.pills}>
                  <Badge tone="neutral">{GENDER_LABEL[p.gender]}</Badge>
                  <Badge tone="neutral">{LEVEL_LABEL[p.level]}</Badge>
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

      {selected ? (
        <PlayerDetailModal
          player={selected}
          batches={data.batches}
          purchases={data.purchases}
          bookings={data.bookings}
          slots={data.slots}
          coaches={data.coaches}
          packages={data.packages}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
