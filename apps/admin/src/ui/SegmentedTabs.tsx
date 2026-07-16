import type { LucideIcon } from 'lucide-react';

import styles from './SegmentedTabs.module.css';

export interface SegmentTab<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** A light track with a white active pill (Week calendar / Availability templates). */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly SegmentTab<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.track} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={styles.tab}
            data-active={active}
            onClick={() => onChange(t.value)}
          >
            {Icon ? <Icon size={16} aria-hidden /> : null}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
