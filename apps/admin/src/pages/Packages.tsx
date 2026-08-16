import { CANCELLATION_WINDOW_HOURS, CREDIT_EXPIRY_DAYS, formatPiastres } from '@tpa/core';
import type { Package } from '@tpa/types';
import { AlertTriangle, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  SELLABLE_TYPES,
  catalogStats,
  deletePackage,
  packageHasHistory,
  packagesForType,
  perSessionPrice,
  setPackageSellable,
} from '../data/packages';
import { combine, useAdminData, useCreditRequests } from '../data/queries';
import { PackageModal } from '../packages/PackageModal';
import { Button, ErrorView, LoadingView, Modal, PageHeader, Toggle, TRAINING_LABEL, TYPE_PLAYERS } from '../ui';
import styles from './Packages.module.css';

const DELETE_ERROR_TEXT: Record<string, string> = {
  not_admin: "You don't have permission.",
  package_missing: 'That package no longer exists.',
  trial_package_protected: 'The trial package can’t be deleted.',
  network: 'Something went wrong. Please try again.',
};

/** Packages route: catalog stats, a section per training type, and package CRUD. */
export function Packages() {
  const data = useAdminData();
  const reqsQ = useCreditRequests();
  const gate = combine(reqsQ);
  const [editing, setEditing] = useState<Package | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Package | null>(null);

  if (data.isPending || gate.isPending) return <LoadingView />;
  if (data.isError || gate.isError) return <ErrorView onRetry={() => { data.refetch(); gate.refetch(); }} />;

  const creditRequests = reqsQ.data ?? [];

  const stats = catalogStats(data.packages);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Packages"
        subtitle={`Session bundles players can buy. Each purchase adds credits of that training type to the player's wallet, valid for ${CREDIT_EXPIRY_DAYS} days.`}
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
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  onEdit={() => setEditing(pkg)}
                  onDelete={() => setDeleting(pkg)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className={styles.footer}>
        <div>
          <p className={styles.footerTitle}>Need a custom bundle?</p>
          <p className={styles.footerBody}>
            The trial is a one-time discounted session a new player can buy once, ever.
          </p>
        </div>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          New package
        </Button>
      </div>

      {editing ? (
        <PackageModal pkg={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      ) : null}

      {deleting ? (
        <PackageDeleteConfirm
          pkg={deleting}
          hasHistory={packageHasHistory(deleting, data.purchases, creditRequests)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

function PackageCard({
  pkg,
  onEdit,
  onDelete,
}: {
  pkg: Package;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
          <button type="button" className={styles.deleteBtn} aria-label={`Delete ${pkg.name}`} onClick={onDelete}>
            <Trash2 size={15} aria-hidden />
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

/**
 * Guarded delete. Copy is computed from real history, not guessed — it tells
 * the admin exactly what delete_package will do before they commit: a
 * package with any purchase or credit request against it is retired (row +
 * history intact, hidden from the catalog), never destroyed; only a
 * genuinely unused one is actually removed. The trial package is blocked
 * outright — deleting or retiring it would take the once-per-player trial
 * flow every future signup depends on off the shelf, which isn't the same
 * operation as discontinuing an ordinary bundle; the Sellable toggle is the
 * right tool to stop selling it.
 */
function PackageDeleteConfirm({
  pkg,
  hasHistory,
  onClose,
}: {
  pkg: Package;
  hasHistory: boolean;
  onClose: () => void;
}) {
  const isTrial = pkg.trainingType === 'trial';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setError(null);
    setBusy(true);
    const res = await deletePackage(pkg.id);
    setBusy(false);
    if (res.ok) onClose();
    else setError(DELETE_ERROR_TEXT[res.reason] ?? 'Could not delete the package.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Catalog"
      title={`Delete ${pkg.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {!isTrial ? (
            <Button variant="destructive" icon={Trash2} onClick={() => void onDelete()} disabled={busy}>
              {hasHistory ? 'Retire package' : 'Delete package'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.confirm}>
        {isTrial ? (
          <p className={styles.confirmLead}>
            This is the trial package the signup flow depends on — it can’t be deleted. Use the Sellable
            toggle instead if you want to stop selling it; the once-per-player trial limit stays enforced
            either way.
          </p>
        ) : hasHistory ? (
          <p className={styles.confirmLead}>
            This package has purchases or credit requests against it, so it will be hidden from the catalog
            to preserve those records, not deleted. Credits already sold stay valid until they expire.
          </p>
        ) : (
          <p className={styles.confirmLead}>
            This package has never been purchased or requested — it will be permanently deleted.
          </p>
        )}
        {error ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
