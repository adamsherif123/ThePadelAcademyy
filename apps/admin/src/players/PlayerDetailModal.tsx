import {
  CREDIT_EXPIRY_DAYS,
  creditExpiryState,
  formatExpiry,
  formatInstantDate,
  formatPiastres,
} from '@tpa/core';
import type {
  Booking,
  Coach,
  CreditBatch,
  CreditSource,
  Gender,
  IsoInstant,
  Level,
  Package,
  PackageId,
  PaymentMethod,
  Piastres,
  Player,
  Purchase,
  SessionSlot,
  TrainingType,
} from '@tpa/types';
import { AlertTriangle, ArrowLeft, Banknote, Gift, Pencil } from 'lucide-react';
import { useState } from 'react';

import { recordCashPurchase } from '../data/cashPurchase';
import { grantCredits } from '../data/grant';
import { sessionRetailValue, SELLABLE_TYPES } from '../data/packages';
import {
  batchesForPlayerSorted,
  mismatchedActiveBookings,
  purchasesForPlayer,
} from '../data/players';
import { bookingsForPlayer, coachById, packageById, slotById } from '../data/selectors';
import { useSession } from '../session/SessionProvider';
import {
  Avatar,
  Badge,
  Button,
  GENDER_LABEL,
  GENDER_OPTIONS,
  Input,
  LEVEL_LABEL,
  LEVEL_OPTIONS,
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

const METHOD_LABEL: Record<PaymentMethod, string> = { paymob: 'Card', cash: 'Cash', instapay: 'InstaPay' };

/** Shared fallback for transport failures and any reason a view doesn't name. */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

const GRANT_ERROR: Record<string, string> = {
  reason_required: 'Say why you’re comping this — it has to be explicable in an audit later.',
  quantity_below_one: 'Grant at least one credit.',
  player_missing: 'That player no longer exists.',
  not_admin: 'You don’t have permission.',
  network: GENERIC_ERROR,
};

const CASH_ERROR: Record<string, string> = {
  amount_below_one: 'The amount received must be above zero.',
  package_missing: 'Pick a package.',
  player_missing: 'That player no longer exists.',
  trial_not_sellable: 'Trials can’t be sold.',
  package_inactive: 'That package is hidden.',
  not_admin: 'You don’t have permission.',
  network: GENERIC_ERROR,
};

type View = 'main' | 'edit' | 'grant' | 'cash';

interface PlayerDetailProps {
  player: Player;
  batches: CreditBatch[];
  purchases: Purchase[];
  bookings: Booking[];
  slots: SessionSlot[];
  coaches: Coach[];
  packages: Package[];
  onClose: () => void;
}

/**
 * Player detail — what the owner opens when someone messages him. Profile, the full
 * wallet (every batch: type, remaining/total, source, expiry state), booking and
 * purchase history, plus the three writes that matter: edit the profile (gender/
 * level change which slots they see), record a cash payment (money IN — a real
 * purchase), and grant comp credits (money OUT — an admin_grant).
 */
export function PlayerDetailModal({
  player,
  batches,
  purchases,
  bookings,
  slots,
  coaches,
  packages,
  onClose,
}: PlayerDetailProps) {
  const { now } = useSession();
  const [view, setView] = useState<View>('main');

  if (view === 'edit')
    return <EditView player={player} bookings={bookings} slots={slots} onBack={() => setView('main')} onClose={onClose} />;
  if (view === 'grant')
    return <GrantView player={player} packages={packages} onBack={() => setView('main')} onClose={onClose} />;
  if (view === 'cash')
    return <CashView player={player} now={now} packages={packages} onBack={() => setView('main')} onClose={onClose} />;

  const walletBatches = batchesForPlayerSorted(batches, player.id);
  const bookingRows = bookingsForPlayer(bookings, player.id)
    .map((b) => ({ booking: b, slot: slotById(slots, b.slotId) }))
    .sort((a, b) => (b.slot ? new Date(b.slot.startsAt).getTime() : 0) - (a.slot ? new Date(a.slot.startsAt).getTime() : 0));
  const playerPurchases = purchasesForPlayer(purchases, player.id);

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
              {player.phone ?? 'No phone'} · Joined {formatInstantDate(player.createdAt)}
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
            <div className={styles.walletActions}>
              <Button size="sm" variant="secondary" icon={Gift} onClick={() => setView('grant')}>
                Grant
              </Button>
              <Button size="sm" icon={Banknote} onClick={() => setView('cash')}>
                Record payment
              </Button>
            </div>
          </div>
          {walletBatches.length === 0 ? (
            <p className={styles.empty}>No credits yet.</p>
          ) : (
            <div className={styles.list}>
              {walletBatches.map((b) => {
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
          {bookingRows.length === 0 ? (
            <p className={styles.empty}>No bookings yet.</p>
          ) : (
            <div className={styles.list}>
              {bookingRows.map(({ booking, slot }) => (
                <div key={booking.id} className={styles.row}>
                  {slot ? <TypePill type={slot.trainingType} /> : null}
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {slot ? formatInstantDate(slot.startsAt) : 'Session'}
                    </span>
                    <span className={styles.rowSub}>
                      {slot ? coachById(coaches, slot.coachId)?.name ?? 'Coach' : ''}
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
          {playerPurchases.length === 0 ? (
            <p className={styles.empty}>No purchases yet.</p>
          ) : (
            <div className={styles.list}>
              {playerPurchases.map((p) => {
                const pkg = packageById(packages, p.packageId);
                return (
                  <div key={p.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{pkg?.name ?? 'Package'}</span>
                      <span className={styles.rowSub}>
                        {formatInstantDate(p.createdAt)} · {METHOD_LABEL[p.paymentMethod]}
                      </span>
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

// ---- EDIT (read-only) ----
// Profile edits aren't wired in the admin: the only players UPDATE policy is
// `players_update_self`, so there's no way to rewrite another player's row from here.
// The form is shown for reference; Save is disabled.
function EditView({
  player,
  bookings,
  slots,
  onBack,
  onClose,
}: {
  player: Player;
  bookings: Booking[];
  slots: SessionSlot[];
  onBack: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [phone, setPhone] = useState(player.phone);
  const [gender, setGender] = useState<Gender>(player.gender);
  const [level, setLevel] = useState<Level>(player.level);

  const mismatch = mismatchedActiveBookings(bookings, slots, player.id, gender, level);
  const profileChanged = gender !== player.gender || level !== player.level;

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
          <Button onClick={onBack} disabled>
            Save changes
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.note}>
          <AlertTriangle size={15} aria-hidden />
          Profile edits aren’t available in the admin — a player’s name, gender, and level can only be
          changed by the player themselves. You can still grant credits and record payments below.
        </p>

        <div className={styles.grid}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} disabled />
          <Input label="Phone" value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} disabled />
          <Select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender)}
            options={GENDER_OPTIONS}
            disabled
          />
          <Select
            label="Level"
            value={level}
            onChange={(e) => setLevel(e.target.value as Level)}
            options={LEVEL_OPTIONS}
            disabled
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
      </div>
    </Modal>
  );
}

// ---- GRANT ----
function GrantView({ player, packages, onBack, onClose }: { player: Player; packages: Package[]; onBack: () => void; onClose: () => void }) {
  const [trainingType, setTrainingType] = useState<TrainingType>('group');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unit = sessionRetailValue(packages, trainingType);
  const totalValue = unit != null ? ((unit * Math.max(1, quantity)) as typeof unit) : null;
  const canSave = reason.trim() !== '' && quantity >= 1 && !saving;

  const onSave = async () => {
    setError(null);
    setSaving(true);
    // Seam returns { ok, reason } and self-invalidates the cache — never throws.
    const res = await grantCredits(player.id, trainingType, quantity, reason);
    setSaving(false);
    if (res.ok) onBack();
    else setError(GRANT_ERROR[res.reason] ?? GENERIC_ERROR);
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
          <Button icon={Gift} onClick={() => void onSave()} disabled={!canSave}>
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

// ---- CASH ----
const sellablePackages = (packages: Package[]): Package[] =>
  packages
    // A5: trial is sellable now — an admin can record a cash trial purchase (once per player).
    .filter((p) => p.isActive)
    .sort((a, b) => a.trainingType.localeCompare(b.trainingType) || a.sessionCount - b.sessionCount);

function CashView({
  player,
  now,
  packages: allPkgs,
  onBack,
  onClose,
}: {
  player: Player;
  now: IsoInstant;
  packages: Package[];
  onBack: () => void;
  onClose: () => void;
}) {
  const packages = sellablePackages(allPkgs);
  const [packageId, setPackageId] = useState<PackageId | ''>(packages[0]?.id ?? '');
  const selected = packages.find((p) => p.id === packageId) ?? null;
  const [amountEgp, setAmountEgp] = useState<number>(selected ? selected.price / 100 : 0);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const amount = Math.round(amountEgp * 100) as Piastres;
  const list = selected?.price ?? (0 as Piastres);
  const delta = amount - list;
  const canSave = selected !== null && amount >= 1 && !saving;
  const expiryDate = formatInstantDate(
    new Date(new Date(now).getTime() + CREDIT_EXPIRY_DAYS * 86_400_000).toISOString() as IsoInstant,
  );

  const pickPackage = (id: string) => {
    setPackageId(id as PackageId);
    const pkg = packages.find((p) => p.id === id);
    if (pkg) setAmountEgp(pkg.price / 100); // amount follows the picked package's list price
  };

  const onSave = async () => {
    if (!selected) return;
    setError(null);
    setSaving(true);
    // Seam returns { ok, reason } and self-invalidates the cache — never throws.
    const res = await recordCashPurchase(player.id, selected.id, amount);
    setSaving(false);
    if (res.ok) onBack();
    else setError(CASH_ERROR[res.reason] ?? GENERIC_ERROR);
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={player.name}
      title="Record cash payment"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <Button icon={Banknote} onClick={() => void onSave()} disabled={!canSave}>
            Record payment
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={styles.grid}>
          <Select
            label="Package"
            value={packageId}
            onChange={(e) => pickPackage(e.target.value)}
            options={packages.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Input
            label="Amount received (EGP)"
            type="number"
            min={1}
            value={amountEgp}
            onChange={(e) => setAmountEgp(Number(e.target.value))}
            hint={
              selected
                ? delta === 0
                  ? 'List price'
                  : `${formatPiastres(Math.abs(delta) as Piastres)} ${delta < 0 ? 'below' : 'above'} list`
                : undefined
            }
          />
        </div>

        {delta > 0 ? (
          <p className={styles.note}>
            <AlertTriangle size={15} aria-hidden />
            That’s above the {formatPiastres(list)} list price — allowed, but double-check it isn’t a typo.
          </p>
        ) : null}

        {selected ? (
          <p className={`${styles.value} ${styles.valueIn}`}>
            <Banknote size={16} aria-hidden />
            <span>
              Records <span className={styles.valueBig}>{formatPiastres(amount)}</span> received and grants{' '}
              {selected.sessionCount} {TRAINING_LABEL[selected.trainingType].toLowerCase()} credit
              {selected.sessionCount === 1 ? '' : 's'}, expiring {expiryDate}.
            </span>
          </p>
        ) : (
          <p className={styles.empty}>No sellable packages to record against.</p>
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
