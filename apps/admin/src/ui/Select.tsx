import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';

import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}
/** An <optgroup>: a heading plus its options. */
export interface SelectGroup {
  label: string;
  options: readonly SelectOption[];
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** Flat options. Ignored when `groups` is given. */
  options?: readonly SelectOption[];
  /**
   * Grouped options, rendered as native <optgroup>s. Used where the grouping IS
   * the information — a package list once packages belong to a branch, for
   * instance, where two branches can sell a bundle of the same name.
   */
  groups?: readonly SelectGroup[];
  /** A line under the control, same role as Input's. */
  hint?: string;
}

/** A labelled native <select> styled to match Input, with a chevron affordance. */
export function Select({ label, options, groups, hint, id, className, ...rest }: SelectProps) {
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
          {groups
            ? groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))
            : (options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
        </select>
        <ChevronDown className={styles.chevron} size={16} aria-hidden />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
