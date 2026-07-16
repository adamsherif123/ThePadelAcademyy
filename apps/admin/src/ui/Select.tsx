import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';

import styles from './Select.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: readonly { value: string; label: string }[];
}

/** A labelled native <select> styled to match Input, with a chevron affordance. */
export function Select({ label, options, id, className, ...rest }: SelectProps) {
  const selectId = id ?? (label ? `sel-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <div className={styles.wrap}>
        <select id={selectId} className={[styles.select, className ?? ''].join(' ').trim()} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.chevron} size={16} aria-hidden />
      </div>
    </div>
  );
}
