import { formatInstantDate, formatInstantTime } from '@tpa/core';
import type { Booking, CoachId, Player, SessionSlot } from '@tpa/types';
import { AlertTriangle, ArrowLeft, Ban, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';

import {
  addPlayerToSlot,
  classifyAdminBooking,
  isActivelyBooked,
  removeBooking,
} from '../data/booking';
import { cancelSession } from '../data/cancelSession';
import {
  activeBookingsForSlot,
  allCoaches,
  allPlayers,
  batchesForPlayer,
  bookingsForSlot,
  coachById,
  playerById,
  slotById,
  usableCreditFor,
} from '../data/selectors';
import { updateSlotDetails } from '../data/slots';
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
  PlayerSearch,
  Select,
  TRAINING_LABEL,
  TYPE_PLAYERS,
  groupTags,
} from '../ui';
import styles from './SlotModal.module.css';

const BLOCK_TEXT: Record<string, string> = {
  slot_full: 'Session full',
  no_usable_credit: 'No usable credit',
  already_booked: 'Already booked',
  slot_in_past: 'Session started',
  slot_cancelled: 'Session cancelled',
};

type View = { k: 'main' } | { k: 'add' } | { k: 'remove'; booking: Booking } | { k: 'cancel' };

/**
 * The slot detail modal: the player roster, and every operational action on the
 * session — add a player (admin-initiated booking), remove one (refund/forfeit),
 * change coach/capacity, or cancel the whole session. Each DESTRUCTIVE action gets
 * its own dedicated confirm view naming its exact target, so they're unconfusable.
 */
export function SlotModal({ slot: initial, onClose }: { slot: SessionSlot; onClose: () => void }) {
  const { now } = useSession();
  useAdminStore(); // re-render as the roster/seats change
  const slot = slotById(initial.id) ?? initial;

  const [view, setView] = useState<View>({ k: 'main' });
  const [coachId, setCoachId] = useState<CoachId>(slot.coachId);
  const [capacity, setCapacity] = useState<number>(slot.capacity);
  const [refund, setRefund] = useState(true); // remove-player: refund is the default, never forfeit
  const [showHistory, setShowHistory] = useState(false);

  const isGroup = slot.gender !== null && slot.level !== null;
  const roster = activeBookingsForSlot(slot.id);
  const occupied = roster.length;
  const emptySeats = Math.max(0, slot.capacity - occupied);
  const history = bookingsForSlot(slot.id).filter((b) => b.status !== 'booked');

  const eyebrow = `${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`;
  const title = `${TRAINING_LABEL[slot.trainingType]} session`;

  const capacityTooLow = capacity < occupied;
  const coachChanged = coachId !== slot.coachId;
  const warnCoachChange = coachChanged && occupied > 0;
  const originalCoach = coachById(slot.coachId)?.name ?? 'the coach';
  const newCoach = coachById(coachId)?.name ?? 'another coach';

  const onSave = () => {
    if (capacityTooLow) return;
    updateSlotDetails(slot.id, coachId, capacity);
    onClose();
  };

  // ---- ADD view: a searchable roster of bookable players ----
  function AddTrailing({ player }: { player: Player }) {
    const credit = usableCreditFor(player.id, slot.trainingType, now);
    const verdict = classifyAdminBooking(
      slot,
      player,
      batchesForPlayer(player.id),
      now,
      isActivelyBooked(slot.id, player.id),
    );
    return (
      <>
        <span className={styles.credit}>
          {credit} credit{credit === 1 ? '' : 's'}
        </span>
        {verdict.kind === 'ok' ? (
          <Button size="sm" onClick={() => addPlayerToSlot(slot.id, player.id, now)}>
            Book
          </Button>
        ) : verdict.kind === 'override' ? (
          <Button
            size="sm"
            variant="secondary"
            className={styles.overrideBtn}
            title={`${verdict.reason === 'gender_mismatch' ? GENDER_LABEL[player.gender] : LEVEL_LABEL[player.level]} — outside this slot's filter`}
            onClick={() => addPlayerToSlot(slot.id, player.id, now)}
          >
            <AlertTriangle size={13} aria-hidden />
            Book anyway
          </Button>
        ) : (
          <span className={styles.blocked}>
            <Ban size={13} aria-hidden />
            {BLOCK_TEXT[verdict.reason] ?? 'Not bookable'}
          </span>
        )}
      </>
    );
  }

  if (view.k === 'add') {
    return (
      <Modal open onClose={onClose} eyebrow={title} title="Add a player" footer={<Button variant="secondary" icon={ArrowLeft} onClick={() => setView({ k: 'main' })}>Back to session</Button>}>
        <p className={styles.addHint}>
          Record a WhatsApp or phone booking. Gender/level can be overridden; players with no usable
          credit must be granted credit first (Players).
        </p>
        <PlayerSearch players={allPlayers()} renderTrailing={(p) => <AddTrailing player={p} />} />
      </Modal>
    );
  }

  // ---- REMOVE view: one player, refund vs forfeit ----
  if (view.k === 'remove') {
    const player = playerById(view.booking.playerId);
    const onConfirm = () => {
      removeBooking(view.booking.id, now, refund);
      setView({ k: 'main' });
      setRefund(true);
    };
    return (
      <Modal
        open
        onClose={onClose}
        eyebrow={title}
        title="Remove player"
        footer={
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setView({ k: 'main' })}>
              Back
            </Button>
            <Button variant="destructive" icon={Trash2} onClick={onConfirm}>
              Remove {player ? player.name.split(' ')[0] : 'player'}
            </Button>
          </>
        }
      >
        <div className={styles.removeHead}>
          <Avatar name={player?.name ?? 'Player'} size={44} />
          <div>
            <p className={styles.removeName}>{player?.name ?? 'Player'}</p>
            <p className={styles.removeSub}>{player?.phone}</p>
          </div>
        </div>
        <p className={styles.removeQ}>What happens to their 1 {TRAINING_LABEL[slot.trainingType]} credit?</p>
        <button type="button" className={styles.choice} data-on={refund} onClick={() => setRefund(true)}>
          <span className={styles.choiceTitle}>Refund it (default)</span>
          <span className={styles.choiceBody}>Academy-initiated — coach swap, court problem, our fault. Returned with its original expiry.</span>
        </button>
        <button type="button" className={styles.choice} data-on={!refund} onClick={() => setRefund(false)}>
          <span className={styles.choiceTitle}>Forfeit it</span>
          <span className={styles.choiceBody}>The player asked out too late — the same outcome as cancelling in the app.</span>
        </button>
      </Modal>
    );
  }

  // ---- CANCEL view: the whole session ----
  if (view.k === 'cancel') {
    const onConfirm = () => {
      cancelSession(slot.id, now);
      onClose();
    };
    return (
      <Modal
        open
        onClose={onClose}
        eyebrow={title}
        title="Cancel session"
        footer={
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setView({ k: 'main' })}>
              Back
            </Button>
            <Button variant="destructive" icon={Trash2} onClick={onConfirm}>
              Cancel session &amp; refund
            </Button>
          </>
        }
      >
        <div className={styles.confirm}>
          <div className={styles.confirmIcon}>
            <AlertTriangle size={22} aria-hidden />
          </div>
          <p className={styles.confirmTitle}>Cancel this whole session?</p>
          <p className={styles.confirmBody}>
            {occupied === 0
              ? 'No players are booked. The session will be removed from the schedule.'
              : `All ${occupied} booked player${occupied === 1 ? '' : 's'} will be refunded to their original credit — regardless of the 3-hour window, since the academy is cancelling.`}
          </p>
        </div>
      </Modal>
    );
  }

  // ---- MAIN view ----
  const footer = (
    <>
      <Button className={styles.cancelBtn} variant="destructive" icon={Ban} onClick={() => setView({ k: 'cancel' })}>
        Cancel session
      </Button>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
      <Button onClick={onSave} disabled={capacityTooLow}>
        Save changes
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} eyebrow={eyebrow} title={title} footer={footer}>
      <div className={styles.body}>
        <div className={styles.summary}>
          <span className={styles.summaryIcon}>
            <Users size={20} aria-hidden />
          </span>
          <div className={styles.summaryText}>
            <p className={styles.summaryTitle}>
              {occupied} of {slot.capacity} booked
            </p>
            <p className={styles.summarySub}>
              {TYPE_PLAYERS[slot.trainingType]} · coached by {originalCoach}
            </p>
          </div>
          {isGroup ? (
            <div className={styles.pills}>
              <Badge tone="neutral">{GENDER_LABEL[slot.gender!]}</Badge>
              <Badge tone="neutral">{LEVEL_LABEL[slot.level!]}</Badge>
            </div>
          ) : null}
        </div>

        {/* Roster */}
        <div className={styles.roster}>
          {roster.map((b) => {
            const player = playerById(b.playerId);
            const tags = player && isGroup ? groupTags(player.gender, player.level) : '';
            return (
              <div key={b.id} className={styles.rosterRow}>
                <Avatar name={player?.name ?? 'Player'} size={36} />
                <div className={styles.rosterInfo}>
                  <span className={styles.rosterName}>{player?.name ?? 'Player'}</span>
                  <span className={styles.rosterSub}>
                    {player?.phone}
                    {tags ? ` · ${tags}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.removeLink}
                  aria-label={`Remove ${player?.name ?? 'player'}`}
                  onClick={() => {
                    setRefund(true);
                    setView({ k: 'remove', booking: b });
                  }}
                >
                  <X size={14} aria-hidden />
                  Remove
                </button>
              </div>
            );
          })}
          {Array.from({ length: emptySeats }, (_, i) => (
            <div key={`empty-${i}`} className={styles.emptySeat}>
              Empty seat
            </div>
          ))}
          {occupied === 0 && emptySeats === 0 ? (
            <p className={styles.emptyState}>No seats on this session.</p>
          ) : null}
        </div>

        <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setView({ k: 'add' })}>
          Add a player
        </Button>

        {history.length > 0 ? (
          <div className={styles.history}>
            <button type="button" className={styles.historyToggle} onClick={() => setShowHistory((s) => !s)}>
              Previously booked ({history.length})
            </button>
            {showHistory
              ? history.map((b) => {
                  const player = playerById(b.playerId);
                  return (
                    <div key={b.id} className={styles.historyRow}>
                      <span className={styles.historyName}>{player?.name ?? 'Player'}</span>
                      <Badge tone={b.status === 'attended' ? 'success' : b.status === 'no_show' ? 'warning' : 'neutral'}>
                        {b.status === 'no_show' ? 'No-show' : b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                      </Badge>
                    </div>
                  );
                })
              : null}
          </div>
        ) : null}

        {/* Edit */}
        <div className={styles.fields}>
          <Select
            label="Coach"
            value={coachId}
            onChange={(e) => setCoachId(e.target.value as CoachId)}
            options={allCoaches().map((c) => ({ value: c.id, label: c.name }))}
          />
          <Input
            label="Capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
            hint={`${TRAINING_LABEL[slot.trainingType]}: ${TYPE_PLAYERS[slot.trainingType]}`}
          />
        </div>

        {capacityTooLow ? (
          <p className={styles.error}>Capacity can’t be below the {occupied} already booked.</p>
        ) : null}
        {warnCoachChange ? (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {occupied} player{occupied === 1 ? '' : 's'} booked expecting {originalCoach} — they’ll be
            reassigned to {newCoach}.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
