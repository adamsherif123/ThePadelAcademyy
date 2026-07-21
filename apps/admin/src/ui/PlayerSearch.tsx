import type { Player } from '@tpa/types';
import { useMemo, useState, type ReactNode } from 'react';

import { Avatar } from './Avatar';
import { matchesPlayerQuery } from './playerQuery';
import { SearchInput } from './SearchInput';
import styles from './PlayerSearch.module.css';

/**
 * A searchable player list — search by name or phone, scrollable rows of avatar +
 * name + phone, with a caller-supplied trailing slot per row (a credit summary and
 * a book button here; a "view" link on S4f's Players screen). Reusable: it owns
 * the search + list; the row's trailing content is the caller's.
 */
export function PlayerSearch({
  players,
  placeholder = 'Search name, phone or email…',
  renderTrailing,
}: {
  players: readonly Player[];
  placeholder?: string;
  renderTrailing?: (player: Player) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => players.filter((p) => matchesPlayerQuery(p, query)), [players, query]);

  return (
    <div className={styles.wrap}>
      <SearchInput value={query} onChange={setQuery} placeholder={placeholder} />
      <ul className={styles.list}>
        {filtered.length === 0 ? (
          <li className={styles.empty}>No players match “{query}”.</li>
        ) : (
          filtered.map((p) => (
            <li key={p.id} className={styles.row}>
              <Avatar name={p.name} size={36} />
              <div className={styles.info}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.phone}>{p.phone ?? 'No phone'}</span>
              </div>
              {renderTrailing ? <div className={styles.trailing}>{renderTrailing(p)}</div> : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
