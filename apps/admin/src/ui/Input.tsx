import type { InputHTMLAttributes } from 'react';

import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper/hint line under the field (e.g. "Group: 3–4 players"). */
  hint?: string;
}

/** A labelled text input. Label + optional hint stack above/below the field. */
export function Input({ label, hint, id, className, ...rest }: InputProps) {
  const inputId = id ?? (label ? `in-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input id={inputId} className={[styles.input, className ?? ''].join(' ').trim()} {...rest} />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
