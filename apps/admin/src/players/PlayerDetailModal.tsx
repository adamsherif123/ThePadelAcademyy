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
  Location,
  LocationId,
  Package,
  PackageId,
  PaymentMethod,
  Piastres,
  Player,
  Purchase,
  SessionSlot,
  TrainingType,
} from '@tpa/types';
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Banknote, Gift, MapPin, Medal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { DeleteCreditBatchReason } from '../lib/api';
import { recordCashPurchase } from '../data/cashPurchase';
import { deleteCreditBatch } from '../data/creditBatch';
import { grantCredits } from '../data/grant';
import { locationNameById } from '../data/locations';
import { activeLocations } from '../data/useSelectedLocation';
import { canTransferBatch, transferCreditBatch, transferTargets, TRANSFER_ERROR } from '../data/transfer';
import { groupBatchesByLocation, groupPackagesByLocation } from '../data/wallet';
import { setPlayerCoach } from '../data/playerCoach';
import { sessionRetailValue, SELLABLE_TYPES } from '../data/packages';
import {
  batchesForPlayerSorted,
  mismatchedActiveBookings,
  purchasesForPlayer,
} from '../data/players';
import { bookingsForPlayer, coachById, packageById, slotById } from '../data/selectors';
import { PaidToggle } from '../purchases/PaidToggle';
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
  // 067: moved here from another branch. Not revenue — the quantity came out of
  // another batch of this same player's.
  transfer: 'Moved branch',
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

/**
 * Exhaustive over what delete_credit_batch can return, so a new server reason is
 * a build error rather than a shrug. batch_has_bookings and batch_has_transfers
 * are both handled earlier with fresher copy (the dialog re-reads the server's
 * answer); they are here so the map stays total.
 */
const DELETE_BATCH_ERROR: Record<DeleteCreditBatchReason | 'network', string> = {
  batch_missing: 'That batch is already gone. Close and reopen to refresh.',
  batch_in_use: 'Something still references this batch, so nothing was removed.',
  batch_has_bookings: 'Someone has booked with these credits, so nothing was removed.',
  batch_has_transfers: 'Credits were moved out of this batch, so nothing was removed.',
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
  /** Every branch, active or not — the wallet has to name closed ones too. */
  locations: Location[];
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
  locations,
  onClose,
}: PlayerDetailProps) {
  const { now } = useSession();
  const [view, setView] = useState<View>('main');
  // Which batch the owner is moving to another branch. Like `deleting`, its own
  // state rather than a View, because it has to carry WHICH batch.
  const [moving, setMoving] = useState<CreditBatch | null>(null);
  // Which batch the owner is about to remove. Its own state rather than a View,
  // because the confirm has to carry WHICH batch — a bare mode string cannot.
  const [deleting, setDeleting] = useState<CreditBatch | null>(null);

  if (view === 'edit')
    return <EditView player={player} bookings={bookings} slots={slots} onBack={() => setView('main')} onClose={onClose} />;
  if (view === 'grant')
    return <GrantView player={player} packages={packages} locations={locations} onBack={() => setView('main')} onClose={onClose} />;
  if (view === 'cash')
    return <CashView player={player} now={now} packages={packages} locations={locations} onBack={() => setView('main')} onClose={onClose} />;
  if (moving)
    return <TransferView batch={moving} locations={locations} onBack={() => setMoving(null)} />;
  if (deleting)
    return (
      <BatchDeleteConfirm
        batch={deleting}
        purchase={deleting.purchaseId ? purchases.find((p) => p.id === deleting.purchaseId) ?? null : null}
        bookingCount={bookings.filter((b) => b.creditBatchId === deleting.id).length}
        transferCount={batches.filter((b) => b.transferredFrom === deleting.id).length}
        locations={locations}
        onBack={() => setDeleting(null)}
      />
    );

  const walletBatches = batchesForPlayerSorted(batches, player.id);
  // Grouped, not flat: with more than one branch a bare list of "4 left" rows
  // cannot answer the only question that matters — WHERE can they spend it.
  const walletGroups = groupBatchesByLocation(walletBatches, locations);
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

        {/* Coach link */}
        <CoachLinkSection player={player} coaches={coaches} />

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
            walletGroups.map((group) => (
              <div key={group.locationId} className={styles.walletGroup}>
                {/* Always shown, even with one branch: "which branch" is now part
                    of what a credit IS, so it should never be implied. */}
                <div className={styles.walletGroupHead}>
                  <MapPin size={13} aria-hidden />
                  <span className={styles.walletGroupName}>{group.locationName}</span>
                  <span className={styles.walletGroupCount}>
                    {group.items.reduce((n, b) => n + b.quantityRemaining, 0)} left
                  </span>
                </div>
                <div className={styles.list}>
                  {group.items.map((b) => {
                    const state = creditExpiryState(b.expiresAt, now);
                    // A transferred batch says where it came from — otherwise
                    // "Moved branch" raises the question it should answer.
                    const from = b.transferredFrom
                      ? batches.find((x) => x.id === b.transferredFrom)
                      : undefined;
                    return (
                      <div key={b.id} className={styles.row}>
                        <TypePill type={b.trainingType} />
                        <div className={styles.rowMain}>
                          <span className={styles.rowTitle}>
                            {b.quantityRemaining} / {b.quantityTotal} left
                          </span>
                          <span className={styles.rowSub}>
                            {b.source === 'transfer'
                              ? `Moved from ${locationNameById(locations, from?.locationId)}`
                              : SOURCE_LABEL[b.source]}
                            {b.note ? ` · ${b.note}` : ''}
                          </span>
                        </div>
                        <div className={styles.rowEnd}>
                          <span className={styles.expiry} data-state={state}>
                            {formatExpiry(b.expiresAt, now)}
                          </span>
                          {canTransferBatch(b, now) ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={ArrowLeftRight}
                              aria-label={`Move these ${TRAINING_LABEL[b.trainingType].toLowerCase()} credits to another location`}
                              onClick={() => setMoving(b)}
                            />
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={Trash2}
                            aria-label={`Delete this ${TRAINING_LABEL[b.trainingType].toLowerCase()} batch`}
                            onClick={() => setDeleting(b)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
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
                      {/* Cash sales have no credit request, so this is where their
                          collection is confirmed. Only a completed purchase can be. */}
                      {p.status === 'succeeded' ? <PaidToggle purchaseId={p.id} paid={p.paid} /> : null}
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

  const mismatch = mismatchedActiveBookings(bookings, slots, player.id, level);
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
            won’t match the new level. Those bookings stay exactly as they are — the change only
            affects which sessions they can book from here on.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

const COACH_LINK_ERROR: Record<string, string> = {
  not_admin: 'Only an admin can change the coach link.',
  player_missing: 'That player no longer exists.',
  coach_missing: 'That coach no longer exists — reload and try again.',
  coach_taken: 'That coach is already linked to another account. Clear the other one first.',
  network: 'Could not reach the server. Try again.',
};

const NOT_A_COACH = '';

/**
 * Links this player's LOGIN to a coaches record — what turns an ordinary account
 * into a coach account (migration 049). Non-null `coach_id` is the coach flag; there
 * is no separate boolean, so this one control is the whole switch.
 *
 * Options are the ACTIVE coaches, plus whichever coach is currently linked even if
 * they have since been deactivated — otherwise editing a coach on leave would
 * silently show "Not a coach" and the next save would unlink them. Saving goes
 * through the admin-gated set_player_coach RPC; a coaches record can only be linked
 * to one account (a partial unique index), which comes back as `coach_taken`.
 */
function CoachLinkSection({ player, coaches }: { player: Player; coaches: Coach[] }) {
  const linked = player.coachId ?? null;
  const [value, setValue] = useState<string>(linked ?? NOT_A_COACH);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = [
    { value: NOT_A_COACH, label: 'Not a coach' },
    ...coaches
      .filter((c) => c.isActive || c.id === linked)
      .map((c) => ({ value: c.id as string, label: c.isActive ? c.name : `${c.name} (inactive)` })),
  ];

  const changed = (value === NOT_A_COACH ? null : value) !== linked;

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const res = await setPlayerCoach(player.id, value === NOT_A_COACH ? null : (value as Coach['id']));
    setSaving(false);
    if (!res.ok) setError(COACH_LINK_ERROR[res.reason] ?? 'Something went wrong.');
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Coach</span>
      <p className={styles.hint}>
        Linking this account to a coach gives it the coach app — their schedule and hours —
        instead of the player app. Each coach can be linked to one account.
      </p>
      <div className={styles.coachRow}>
        <Select
          label="Coach record"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          options={options}
          disabled={saving}
        />
        <Button size="sm" icon={Medal} onClick={() => void onSave()} disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save link'}
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

// ---- GRANT ----
function GrantView({ player, packages, locations, onBack, onClose }: { player: Player; packages: Package[]; locations: Location[]; onBack: () => void; onClose: () => void }) {
  const [trainingType, setTrainingType] = useState<TrainingType>('group');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only ACTIVE branches: grant_credits refuses a closed one (location_unavailable),
  // so offering it would be offering a guaranteed failure. Defaults to the first
  // active branch — the RPC would default to the DEFAULT branch, but an owner
  // should see which branch they are about to comp, never infer it.
  const branches = activeLocations(locations);
  const [locationId, setLocationId] = useState<LocationId | ''>(branches[0]?.id ?? '');

  const unit = sessionRetailValue(packages, trainingType);
  const totalValue = unit != null ? ((unit * Math.max(1, quantity)) as typeof unit) : null;
  const canSave = reason.trim() !== '' && quantity >= 1 && locationId !== '' && !saving;

  const onSave = async () => {
    if (locationId === '') return;
    setError(null);
    setSaving(true);
    // Seam returns { ok, reason } and self-invalidates the cache — never throws.
    const res = await grantCredits(player.id, trainingType, quantity, reason, locationId);
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

        {/* Required, and full width: a credit is only spendable at ONE branch
            (065), so this is as load-bearing as the training type. */}
        <Select
          label="Location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value as LocationId)}
          options={branches.map((l) => ({ value: l.id, label: l.name }))}
          hint="These credits can only be used at this location."
        />

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
              {TRAINING_LABEL[trainingType].toLowerCase()} training. Grants expire in {CREDIT_EXPIRY_DAYS} days like any
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
  locations,
  onBack,
  onClose,
}: {
  player: Player;
  now: IsoInstant;
  packages: Package[];
  locations: Location[];
  onBack: () => void;
  onClose: () => void;
}) {
  const packages = sellablePackages(allPkgs);
  // Grouped by branch, because two branches may sell a bundle with the SAME name
  // at different prices — a flat list would make those indistinguishable, and
  // picking the wrong one mints credits at the wrong branch.
  const pkgGroups = groupPackagesByLocation(packages, locations);
  const [packageId, setPackageId] = useState<PackageId | ''>(pkgGroups[0]?.items[0]?.id ?? '');
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
            groups={pkgGroups.map((g) => ({
              label: g.locationName,
              options: g.items.map((p) => ({ value: p.id, label: p.name })),
            }))}
            hint={selected ? `Credits will be usable at ${locationNameById(locations, selected.locationId)}.` : undefined}
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
              Records a <span className={styles.valueBig}>{formatPiastres(amount)}</span> purchase and grants{' '}
              {selected.sessionCount} {TRAINING_LABEL[selected.trainingType].toLowerCase()} credit
              {selected.sessionCount === 1 ? '' : 's'}, expiring {expiryDate}. It counts toward revenue once
              you mark it paid.
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

/**
 * Remove a credit batch, and the purchase / credit request behind it.
 *
 * The undo for a payment recorded against the wrong player, or a request
 * approved twice. It is the only destructive money action in the admin, so the
 * confirm spells out every row that will disappear rather than asking "are you
 * sure?" about an unnamed thing.
 *
 * A batch that has been booked against cannot be removed at all, and the dialog
 * says so BEFORE the owner commits to the click — the server refuses it either
 * way (batch_has_bookings), but finding that out from an error message after
 * pressing a red button is a worse way to learn it. Those bookings are the
 * attendance history coach hours are paid from; deleting the batch would rewrite
 * what somebody is owed.
 */
/**
 * Move some of a batch's remaining credits to another branch (067).
 *
 * Quantity defaults to the WHOLE remainder, because that is the common case —
 * "this player has moved to the other branch" — and splitting is the exception.
 * The note is required by the RPC and is the only record of why value moved
 * between two branches' books, so it is a first-class field here, not a footnote.
 */
function TransferView({
  batch,
  locations,
  onBack,
}: {
  batch: CreditBatch;
  locations: Location[];
  onBack: () => void;
}) {
  const targets = transferTargets(locations, batch);
  const [toLocationId, setToLocationId] = useState<LocationId | ''>(targets[0]?.id ?? '');
  const [quantity, setQuantity] = useState(batch.quantityRemaining);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typeLabel = TRAINING_LABEL[batch.trainingType].toLowerCase();
  const canSave =
    toLocationId !== '' && note.trim() !== '' && quantity >= 1 && quantity <= batch.quantityRemaining && !busy;

  const onSave = async () => {
    if (toLocationId === '') return;
    setError(null);
    setBusy(true);
    const res = await transferCreditBatch(batch.id, toLocationId, quantity, note);
    setBusy(false);
    if (res.ok) onBack();
    else setError(TRANSFER_ERROR[res.reason]);
  };

  return (
    <Modal
      open
      onClose={onBack}
      eyebrow="Wallet"
      title="Move credits to another location"
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button icon={ArrowLeftRight} onClick={() => void onSave()} disabled={!canSave}>
            {busy ? 'Moving…' : `Move ${quantity} credit${quantity === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <p className={styles.confirmBatch}>
          {batch.quantityRemaining} {typeLabel} credit{batch.quantityRemaining === 1 ? '' : 's'} at{' '}
          {locationNameById(locations, batch.locationId)}
        </p>

        {targets.length === 0 ? (
          <p className={styles.confirmWarn}>
            There’s nowhere to move these to — you need a second open location first.
          </p>
        ) : (
          <>
            <div className={styles.grid}>
              <Select
                label="Move to"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value as LocationId)}
                options={targets.map((l) => ({ value: l.id, label: l.name }))}
              />
              <Input
                label="How many"
                type="number"
                min={1}
                max={batch.quantityRemaining}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                hint={`${batch.quantityRemaining} available`}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="transfer-note">
                Reason (required)
              </label>
              <textarea
                id="transfer-note"
                className={styles.textarea}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. court closed for maintenance"
              />
            </div>

            {/* The two things an owner is most likely to assume wrongly. */}
            <p className={styles.hint}>
              The credits keep their original expiry — moving them doesn’t extend it — and the player
              will only be able to use the moved credits at the new location.
            </p>
          </>
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

function BatchDeleteConfirm({
  batch,
  purchase,
  bookingCount,
  transferCount,
  locations,
  onBack,
}: {
  batch: CreditBatch;
  purchase: Purchase | null;
  bookingCount: number;
  /** Batches transferred OUT of this one — 067 refuses the delete while any exist. */
  transferCount: number;
  locations: Location[];
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = bookingCount > 0 || transferCount > 0;
  const typeLabel = TRAINING_LABEL[batch.trainingType].toLowerCase();

  const onDelete = async () => {
    setError(null);
    setBusy(true);
    const res = await deleteCreditBatch(batch.id);
    setBusy(false);
    if (res.ok) {
      onBack();
      return;
    }
    // The server is the authority on bookings, not the count this dialog was
    // opened with: one could have landed in between.
    if (res.reason === 'batch_has_bookings') {
      setError('Someone has booked with these credits since you opened this. Nothing was removed.');
      return;
    }
    // Same shape: the server is the authority, and a transfer could have landed
    // between opening this dialog and confirming it.
    if (res.reason === 'batch_has_transfers') {
      setError('Credits were moved out of this batch since you opened this. Nothing was removed.');
      return;
    }
    setError(DELETE_BATCH_ERROR[res.reason] ?? 'Could not remove the batch.');
  };

  return (
    <Modal
      open
      onClose={onBack}
      eyebrow="Wallet"
      title={blocked ? 'Can’t remove these credits' : 'Remove these credits?'}
      footer={
        <>
          <Button variant="secondary" icon={ArrowLeft} onClick={onBack} disabled={busy}>
            Back
          </Button>
          {!blocked ? (
            <Button variant="destructive" icon={Trash2} onClick={() => void onDelete()} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.confirm}>
        <p className={styles.confirmBatch}>
          {batch.quantityRemaining} of {batch.quantityTotal} {typeLabel} credit
          {batch.quantityTotal === 1 ? '' : 's'} · {SOURCE_LABEL[batch.source]} at{' '}
          {locationNameById(locations, batch.locationId)}
          {batch.note ? ` · ${batch.note}` : ''}
        </p>

        {transferCount > 0 ? (
          <p className={styles.confirmWarn}>
            {transferCount === 1 ? 'A batch of credits was' : `${transferCount} batches of credits were`} moved
            out of this one to another location, so it can’t be removed — deleting it would leave
            {transferCount === 1 ? ' that batch' : ' those batches'} with no record of where the credits
            came from. Remove the moved {transferCount === 1 ? 'batch' : 'batches'} first if this really
            was a mistake.
          </p>
        ) : blocked ? (
          <p className={styles.confirmWarn}>
            {bookingCount} booking{bookingCount === 1 ? ' has' : 's have'} already been made against this
            batch, so it can’t be removed — those bookings are what coach hours are counted from. Cancel
            the booking{bookingCount === 1 ? '' : 's'} first if this really was a mistake.
          </p>
        ) : (
          <>
            <p className={styles.confirmLead}>This permanently removes:</p>
            <ul className={styles.confirmList}>
              <li>
                the {batch.quantityRemaining} unused {typeLabel} credit
                {batch.quantityRemaining === 1 ? '' : 's'} in this batch
              </li>
              {purchase ? (
                <li>
                  its {METHOD_LABEL[purchase.paymentMethod].toLowerCase()} purchase of{' '}
                  {formatPiastres(purchase.amount)} — which also takes it out of revenue
                </li>
              ) : null}
              {purchase ? <li>the credit request behind it, if it came from one</li> : null}
            </ul>
            <p className={styles.confirmWarn}>This can’t be undone.</p>
          </>
        )}

        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </Modal>
  );
}
