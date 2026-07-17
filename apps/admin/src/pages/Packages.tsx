import { CANCELLATION_WINDOW_HOURS, CREDIT_EXPIRY_DAYS, formatPiastres } from '@tpa/core';
import type { Package } from '@tpa/types';
import { Check, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import {
  SELLABLE_TYPES,
  catalogStats,
  packagesForType,
  perSessionPrice,
  setPackageSellable,
} from '../data/packages';
import { useAdminData } from '../data/queries';
import { PackageModal } from '../packages/PackageModal';
import { Button, ErrorView, LoadingView, PageHeader, Toggle, TRAINING_LABEL, TYPE_PLAYERS } from '../ui';
import styles from './Packages.module.css';

/** Packages route: catalog stats, a section per training type, and package CRUD. */
export function Packages() {
  const data = useAdminData();
  const [editing, setEditing] = useState<Package | 'new' | null>(null);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  const stats = catalogStats(data.packages);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Packages"
        subtitle="Session bundles players can buy. Each purchase adds credits of that training type to the player's wallet, valid for 30 days."
      />

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <span className={styles.statEyebrow}>Active packages</span>
          <span className={styles.statValue}>{stats.activeCount}</span>
          <span className={styles.statCaption}>of {stats.totalCount} total</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statEyebrow}>Lowest entry</span>
          <span className={styles.statValue}>{stats.lowestEntry ? formatPiastres(stats.lowestEntry.price) : '—'}</span>
          <span className={styles.statCaption}>{stats.lowestEntry?.descriptor ?? 'No sellable packages'}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statEyebrow}>Best value / session</span>
          <span className={styles.statValue}>{stats.bestValue ? formatPiastres(stats.bestValue.perSession) : '—'}</span>
          <span className={styles.statCaption}>{stats.bestValue?.descriptor ?? 'No sellable packages'}</span>
        </div>
      </div>

      {SELLABLE_TYPES.map((type) => {
        const list = packagesForType(data.packages, type);
        if (list.length === 0) return null;
        return (
          <section key={type} className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionDot} data-type={type} />
              <span className={styles.sectionLabel}>{TRAINING_LABEL[type]}</span>
              <span className={styles.sectionHint}>{TYPE_PLAYERS[type]}</span>
            </div>
            <div className={styles.cards}>
              {list.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} onEdit={() => setEditing(pkg)} />
              ))}
            </div>
          </section>
        );
      })}

      <div className={styles.footer}>
        <div>
          <p className={styles.footerTitle}>Need a custom bundle?</p>
          <p className={styles.footerBody}>
            Trial credits are granted automatically at signup and are never sold.
          </p>
        </div>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          New package
        </Button>
      </div>

      {editing ? (
        <PackageModal pkg={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PackageCard({ pkg, onEdit }: { pkg: Package; onEdit: () => void }) {
  return (
    <div className={styles.card} data-hidden={!pkg.isActive}>
      <div className={styles.cardTop}>
        <span className={styles.count}>{pkg.sessionCount}</span>
        <span className={styles.countLabel}>{pkg.sessionCount === 1 ? 'Session' : 'Sessions'}</span>
      </div>
      <div className={styles.price}>{formatPiastres(pkg.price)}</div>
      <div className={styles.perSession}>{formatPiastres(perSessionPrice(pkg))} / session</div>

      <div className={styles.perks}>
        <span className={styles.perk}>
          <Check className={styles.perkIcon} size={15} aria-hidden />
          Valid {CREDIT_EXPIRY_DAYS} days from purchase
        </span>
        <span className={styles.perk}>
          <Check className={styles.perkIcon} size={15} aria-hidden />
          Free cancel up to {CANCELLATION_WINDOW_HOURS}h before
        </span>
      </div>

      <div className={styles.cardFoot}>
        <span className={styles.footLabel}>{pkg.isActive ? 'Sellable' : 'Hidden'}</span>
        <div className={styles.footEnd}>
          <button type="button" className={styles.editBtn} aria-label={`Edit ${pkg.name}`} onClick={onEdit}>
            <Pencil size={15} aria-hidden />
          </button>
          <Toggle
            checked={pkg.isActive}
            onChange={(v) => void setPackageSellable(pkg.id, v)}
            label={`${pkg.name} sellable`}
          />
        </div>
      </div>
    </div>
  );
}
