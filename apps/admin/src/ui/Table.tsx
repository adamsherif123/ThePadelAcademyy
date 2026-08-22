import type { ReactNode } from 'react';

import styles from './Table.module.css';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'start' | 'end';
}

/**
 * A columns-driven data table (bookings, players). Generic over the row type; the
 * caller supplies columns with a `render` per cell and a stable key per row. Head
 * cells are the uppercase muted labels from the v0 tables.
 */
export function Table<T>({
  columns,
  rows,
  keyOf,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  keyOf: (row: T) => string;
}) {
  return (
    // The scroll container is the point: a table too wide for the viewport scrolls
    // HERE, inside its own bounded box, instead of widening the page and making the
    // whole layout pan sideways. On desktop the table always fits, so this div is
    // visually inert.
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={styles.th} data-align={c.align ?? 'start'}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} className={styles.row}>
              {columns.map((c) => (
                <td key={c.key} className={styles.td} data-align={c.align ?? 'start'}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
