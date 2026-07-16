import { Search } from 'lucide-react';

import styles from './SearchInput.module.css';

/** A pill search field with a leading magnifier (bookings/players filters). */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.wrap}>
      <Search className={styles.icon} size={18} aria-hidden />
      <input
        className={styles.input}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}
