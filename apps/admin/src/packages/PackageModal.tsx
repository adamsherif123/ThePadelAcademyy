import { PIASTRES_PER_EGP, formatPiastres } from '@tpa/core';
import type { Package, Piastres, TrainingType } from '@tpa/types';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import {
  SELLABLE_TYPES,
  createPackage,
  updatePackage,
  type SavePackageResult,
} from '../data/packages';
import { Button, Input, Modal, Select, Toggle, TRAINING_LABEL } from '../ui';
import styles from './PackageModal.module.css';

const ERROR_TEXT: Record<string, string> = {
  name_required: 'A package needs a name.',
  price_below_one: 'Set a price above zero.',
  sessions_below_one: 'A package must grant at least one session.',
  trial_not_sellable: 'Trial credits are only granted at signup — they can’t be sold.',
  package_missing: 'That package no longer exists.',
};

const suggestName = (type: TrainingType, sessions: number): string =>
  `${TRAINING_LABEL[type]} · ${sessions} Session${sessions === 1 ? '' : 's'}`;

/**
 * New or edit package. On EDIT, trainingType and sessionCount are locked (they're
 * the bundle's identity — an already-sold "8-pack" can't quietly become a 6-pack);
 * only price / name / sellability change, and a price edit affects future purchases
 * only. Trial is not offered as a type at all — the app has no concept of selling one.
 */
export function PackageModal({ pkg, onClose }: { pkg?: Package; onClose: () => void }) {
  const editing = pkg !== undefined;
  const [trainingType, setTrainingType] = useState<TrainingType>(pkg?.trainingType ?? 'group');
  const [sessionCount, setSessionCount] = useState<number>(pkg?.sessionCount ?? 4);
  const [priceEgp, setPriceEgp] = useState<number>(pkg ? pkg.price / PIASTRES_PER_EGP : 1600);
  const [name, setName] = useState<string>(pkg?.name ?? suggestName('group', 4));
  const [isActive, setIsActive] = useState<boolean>(pkg?.isActive ?? true);
  // Track whether the name was hand-edited; if not, keep it in step with type/count.
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = Math.round(priceEgp * PIASTRES_PER_EGP) as Piastres;
  const perSession =
    sessionCount > 0 && price > 0 ? formatPiastres(Math.round(price / sessionCount) as Piastres) : '—';
  const canSave = name.trim() !== '' && price >= 1 && sessionCount >= 1;

  const retypeName = (type: TrainingType, count: number) => {
    if (!nameTouched) setName(suggestName(type, count));
  };

  const onSubmit = () => {
    const draft = { trainingType, sessionCount, price, name, isActive };
    const res: SavePackageResult = editing ? updatePackage(pkg.id, draft) : createPackage(draft);
    if (res.ok) onClose();
    else setError(ERROR_TEXT[res.reason] ?? 'Could not save the package.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Catalog"
      title={editing ? 'Edit package' : 'New package'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSave}>
            {editing ? 'Save package' : 'Create package'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.grid}>
          <div>
            <Select
              label="Training type"
              value={trainingType}
              disabled={editing}
              onChange={(e) => {
                const t = e.target.value as TrainingType;
                setTrainingType(t);
                retypeName(t, sessionCount);
              }}
              options={SELLABLE_TYPES.map((t) => ({ value: t, label: TRAINING_LABEL[t] }))}
            />
            {editing ? <p className={styles.lockHint}>Locked — make a new package to change this.</p> : null}
          </div>
          <div>
            <Input
              label="Sessions"
              type="number"
              min={1}
              value={sessionCount}
              disabled={editing}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSessionCount(n);
                retypeName(trainingType, n);
              }}
            />
            {editing ? <p className={styles.lockHint}>Locked — sold credits captured this count.</p> : null}
          </div>

          <Input
            label="Price (EGP)"
            type="number"
            min={1}
            value={priceEgp}
            onChange={(e) => setPriceEgp(Number(e.target.value))}
            hint={perSession === '—' ? undefined : `${perSession} / session`}
          />
          <div className={styles.span2}>
            <Input
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
            />
          </div>
        </div>

        <div className={styles.activeRow}>
          <div className={styles.activeText}>
            <span className={styles.activeTitle}>{isActive ? 'Sellable' : 'Hidden'}</span>
            <span className={styles.activeSub}>
              {isActive
                ? 'Shown to players and available to buy.'
                : 'Not sold. Credits already purchased stay valid until they expire.'}
            </span>
          </div>
          <Toggle checked={isActive} onChange={setIsActive} label="Package sellable" />
        </div>

        {editing ? (
          <p className={styles.perSession}>
            Editing the price changes future purchases only — existing credits keep what players paid.
          </p>
        ) : null}

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
