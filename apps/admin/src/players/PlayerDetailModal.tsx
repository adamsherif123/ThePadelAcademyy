import {
  creditExpiryState,
  formatExpiry,
  formatInstantDate,
  formatPiastres,
  GENDERS,
  LEVELS,
} from '@tpa/core';
import type { CreditSource, Gender, IsoInstant, Level, Player, TrainingType } from '@tpa/types';
import { AlertTriangle, ArrowLeft, Gift, Pencil } from 'lucide-react';
import { useState } from 'react';

import { grantCredits } from '../data/grant';
import { sessionRetailValue, SELLABLE_TYPES } from '../data/packages';
import {
  batchesForPlayerSorted,
  mismatchedActiveBookings,
  purchasesForPlayer,
  updatePlayerProfile,
} from '../data/players';
import { bookingsForPlayer, coachById, packageById, slotById } from '../data/selectors';
import { useAdminStore } from '../data/store';
import { useSession } from '../session/SessionProvider';
import {
  Avatar,
  Badge,
  Button,
  GENDER_LABEL,
  Input,
  LEVEL_LABEL,
  Modal,
  Select,
  StatusChip,
  TRAINING_LABEL,
  TypePill,
} from '../ui';
import styles from './PlayerDetailModal.module.css';

const SOURCE_LABEL: Record<CreditSource, string> = {
  purchase: 'Purchased',
  admin_grant: 'Granted',
  signup_grant: 'Signup trial',
};

type View = 'main' | 'edit' | 'grant';

/**
 * Player detail — what the owner opens when someone messages him. Profile, the full
 * wallet (every batch: type, remaining/total, source, expiry state), booking and
 * purchase history, plus the two writes that matter: edit the profile (gender/level
 * change which slots they see) and grant comp credits (admin_grant).
 */
export function PlayerDetailModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const { now } = useSession();
  useAdminStore();
  const [view, setView] = useState<View>('main');

  if (view === 'edit') return <EditView player={player} onBack={() => setView('main')} onClose={onClose} />;
  if (view === 'grant') return <GrantView player={player} now={now} onBack={() => setView('main')} onClose={onClose} />;

  const batches = batchesForPlayerSorted(player.id);
  const bookings = bookingsForPlayer(player.id)
    .map((b) => ({ booking: b, slot: slotById(b.slotId) }))
    .sort((a, b) => (b.slot ? new Date(b.slot.startsAt).getTime() : 0) - (a.slot ? new Date(a.slot.startsAt).getTime() : 0));
  const purchases = purchasesForPlayer(player.id);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Player"
      title={player.name}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className={styles.body}>
        {/* Profile */}
        <div className={styles.profile}>
          <Avatar name={player.name} size={48} />
          <div className={styles.profileInfo}>
            <span className={styles.profileName}>{player.name}</span>
            <span className={styles.profileMeta}>
              {player.phone} · Joined {formatInstantDate(player.createdAt)}
            </span>
            <div className={styles.pills}>
              <Badge tone="neutral">{GENDER_LABEL[player.gender]}</Badge>
              <Badge tone="neutral">{LEVEL_LABEL[player.level]}</Badge>
            </div>
          </div>
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setView('edit')}>
            Edit
          </Button>
        </div>

        {/* Wallet */}
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Wallet</span>
            <Button size="sm" icon={Gift} onClick={() => setView('grant')}>
              Grant credits
            </Button>
          </div>
          {batches.length === 0 ? (
            <p className={styles.empty}>No credits yet.</p>
          ) : (
            <div className={styles.list}>
              {batches.map((b) => {
                const state = creditExpiryState(b.expiresAt, now);
                return (
                  <div key={b.id} className={styles.row}>
                    <TypePill type={b.trainingType} />
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>
                        {b.quantityRemaining} / {b.quantityTotal} left
                      </span>
                      <span className={styles.rowSub}>
                        {SOURCE_LABEL[b.source]}
                        {b.source === 'admin_grant' && b.note ? ` · ${b.note}` : ''}
                      </span>
                    </div>
                    <div className={styles.rowEnd}>
                      <span className={styles.expiry} data-state={state}>
                        {formatExpiry(b.expiresAt, now)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bookings */}
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Bookings</span>
          {bookings.length === 0 ? (
            <p className={styles.empty}>No bookings yet.</p>
          ) : (
            <div className={styles.list}>
              {bookings.map(({ booking, slot }) => (
                <div key={booking.id} className={styles.row}>
                  {slot ? <TypePill type={slot.trainingType} /> : null}
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {slot ? formatInstantDate(slot.startsAt) : 'Session'}
                    </span>
                    <span className={styles.rowSub}>
                      {slot ? coachById(slot.coachId)?.name ?? 'Coach' : ''}
                    </span>
                  </div>
                  <div className={styles.rowEnd}>
                    <StatusChip status={booking.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Purchases */}
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Purchases</span>
          {purchases.length === 0 ? (
            <p className={styles.empty}>No purchases yet.</p>
          ) : (
            <div className={styles.list}>
              {purchases.map((p) => {
                const pkg = packageById(p.packageId);
                return (
                  <div key={p.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{pkg?.name ?? 'Package'}</span>
                      <span className={styles.rowSub}>{formatInstantDate(p.createdAt)}</span>
                    </div>
                    <div className={styles.rowEnd}>
                      <span className={styles.amount}>{formatPiastres(p.amount)}</span>
                      <Badge tone={p.status === 'succeeded' ? 'success' : p.status === 'failed' ? 'danger' : 'neutral'}>
                        {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---- EDIT ----
function EditView({ player, onBack, onClose }: { player: Player; onBack: () => void; onClose: () => void }) {
  const [name, setName] = useState(player.name);
  const [phone, setPhone] = useState(player.phone);
  const [gender, setGender] = useState<Gender>(player.gender);
  const [level, setLevel] = useState<Level>(player.level);
  const [error, setError] = useState<string | null>(null);

  const mismatch = mismatchedActiveBookings(player.id, gender, level);
  const profileChanged = gender !== player.gender || level !== player.level;

  const onSave = () => {
    const res = updatePlayerProfile(player.id, { name, phone, gender, level });
    if (res.ok) onBack();
    else
      setError(
        res.reason === 'name_required'
          ? 'A player needs a name.'
          : res.reason === 'phone_required'
            ? 'A player needs a phone number.'
            : 'That player no longer exists.',
      );
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={player.name}
      title="Edit player"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <Button onClick={onSave} disabled={name.trim() === '' || phone.trim() === ''}>
            Save changes
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.grid}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
            options={GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] }))}
          />
          <Select
            label="Level"
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
          />
        </div>

        {profileChanged && mismatch > 0 ? (
          <p className={styles.note}>
            <AlertTriangle size={15} aria-hidden />
            This player holds {mismatch} active booking{mismatch === 1 ? '' : 's'} on group sessions that
            won’t match the new gender/level. Those bookings stay exactly as they are — the change only
            affects which sessions they can book from here on.
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

// ---- GRANT ----
function GrantView({ player, now, onBack, onClose }: { player: Player; now: IsoInstant; onBack: () => void; onClose: () => void }) {
  const [trainingType, setTrainingType] = useState<TrainingType>('group');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unit = sessionRetailValue(trainingType);
  const totalValue = unit != null ? ((unit * Math.max(1, quantity)) as typeof unit) : null;
  const canSave = reason.trim() !== '' && quantity >= 1;

  const onSave = () => {
    const res = grantCredits(player.id, trainingType, quantity, reason, now);
    if (res.ok) onBack();
    else
      setError(
        res.reason === 'reason_required'
          ? 'Say why you’re comping this — it has to be explicable in an audit later.'
          : res.reason === 'quantity_below_one'
            ? 'Grant at least one credit.'
            : 'That player no longer exists.',
      );
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={player.name}
      title="Grant credits"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <Button icon={Gift} onClick={onSave} disabled={!canSave}>
            Grant {quantity} credit{quantity === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.grid}>
          <Select
            label="Training type"
            value={trainingType}
            onChange={(e) => setTrainingType(e.target.value as TrainingType)}
            options={SELLABLE_TYPES.map((t) => ({ value: t, label: TRAINING_LABEL[t] }))}
          />
          <Input
            label="Credits"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="grant-reason">
            Reason (required)
          </label>
          <textarea
            id="grant-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Rained-out session on Jul 10 — comped as goodwill."
          />
        </div>

        {totalValue != null ? (
          <p className={styles.value}>
            <Gift size={16} aria-hidden />
            <span>
              This comps <span className={styles.valueBig}>{formatPiastres(totalValue)}</span> of{' '}
              {TRAINING_LABEL[trainingType].toLowerCase()} training. Grants expire in 30 days like any
              credit — a comp buys no extra time.
            </span>
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
