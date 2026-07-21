import {
  cairoCalendarDate,
  formatInstantDate,
  formatInstantTime,
  isSessionConfirmed,
  parseInstant,
} from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CoachId,
  CreditBatch,
  Player,
  SessionSlot,
  Weekday,
} from '@tpa/types';
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, Check, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';

import { markAttendance, type AttendanceStatus } from '../data/attendance';
import {
  addPlayerToSlot,
  classifyAdminBooking,
  isActivelyBooked,
  removeBooking,
} from '../data/booking';
import { cancelSession } from '../data/cancelSession';
import { confirmSession } from '../data/confirm';
import {
  cairoWallMinutes,
  closedWeekdays,
  findCoachConflict,
  slotTimesFromWall,
} from '../data/schedule';
import {
  activeBookingsForSlot,
  batchesForPlayer,
  bookingsForSlot,
  coachById,
  playerById,
  slotById,
  usableCreditFor,
} from '../data/selectors';
import { activePlayers } from '../data/players';
import { updateSlotDetails } from '../data/slots';
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
  StatusChip,
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

/** Seam reason → admin-facing copy. Always has a fallback (network / unknown). */
const REASON_COPY: Record<string, string> = {
  not_admin: "You don't have permission.",
  slot_missing: 'That session no longer exists.',
  player_missing: 'That player no longer exists.',
  booking_missing: 'That booking no longer exists.',
  already_cancelled: 'That was already cancelled.',
  slot_cancelled: 'That session was cancelled.',
  slot_in_past: 'That session has already started.',
  slot_full: 'This session is full.',
  already_booked: 'That player is already booked on this session.',
  no_usable_credit: 'That player has no usable credit for this session.',
  gender_mismatch: "That player is outside this session's gender filter.",
  level_mismatch: "That player is outside this session's level filter.",
  capacity_below_booked: 'Capacity can’t be below the number already booked.',
  end_before_start: 'The session must end after it starts.',
  in_past: 'That start time is in the past.',
  coach_conflict: 'That coach is already booked at this time.',
  invalid_status: 'That attendance status isn’t allowed.',
  session_not_started: 'That session hasn’t started yet.',
  network: 'Something went wrong. Please try again.',
};
const copyFor = (reason: string): string => REASON_COPY[reason] ?? 'Something went wrong. Please try again.';

const pad = (n: number) => String(n).padStart(2, '0');
/** Sane session durations (a padel session isn't 12 hours — the select IS the guard). */
const DURATIONS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 90, label: '1.5 hr' },
  { value: 120, label: '2 hr' },
  { value: 150, label: '2.5 hr' },
  { value: 180, label: '3 hr' },
];

type View =
  | { k: 'main' }
  | { k: 'add' }
  | { k: 'remove'; booking: Booking }
  | { k: 'cancel' }
  | { k: 'reschedule' };

/**
 * The slot detail modal: the player roster, and every operational action on the
 * session — add a player (admin-initiated booking), remove one (refund/forfeit),
 * change coach/capacity, or cancel the whole session. Each DESTRUCTIVE action gets
 * its own dedicated confirm view naming its exact target, so they're unconfusable.
 */
export function SlotModal({
  slot: initial,
  slots,
  bookings,
  players,
  batches,
  coaches,
  templates,
  onClose,
}: {
  slot: SessionSlot;
  slots: SessionSlot[];
  bookings: Booking[];
  players: Player[];
  batches: CreditBatch[];
  coaches: Coach[];
  templates: AvailabilityTemplate[];
  onClose: () => void;
}) {
  const { now } = useSession();
  // The query cache re-renders us as the roster/seats change; re-derive the live slot.
  const slot = slotById(slots, initial.id) ?? initial;
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const startWall0 = cairoWallMinutes(slot.startsAt);
  const endWall0 = cairoWallMinutes(slot.endsAt);
  const duration0 = endWall0 >= startWall0 ? endWall0 - startWall0 : endWall0 + 24 * 60 - startWall0;
  const cairo0 = cairoCalendarDate(slot.startsAt);

  const [view, setView] = useState<View>({ k: 'main' });
  const [coachId, setCoachId] = useState<CoachId>(slot.coachId);
  const [capacity, setCapacity] = useState<number>(slot.capacity);
  const [dateStr, setDateStr] = useState(`${cairo0.year}-${pad(cairo0.month)}-${pad(cairo0.day)}`);
  const [startStr, setStartStr] = useState(`${pad(Math.floor(startWall0 / 60))}:${pad(startWall0 % 60)}`);
  const [durationMin, setDurationMin] = useState(duration0);
  const [refund, setRefund] = useState(true); // remove-player: refund is the default, never forfeit
  const [showHistory, setShowHistory] = useState(false);

  const isGroup = slot.gender !== null && slot.level !== null;
  const activeRoster = activeBookingsForSlot(bookings, slot.id);
  const occupied = activeRoster.length;
  const emptySeats = Math.max(0, slot.capacity - occupied);

  // Attendance is taken per session, once it has happened. On a PAST session the
  // roster shows everyone who held a seat (booked/attended/no_show) with attendance
  // controls; on a FUTURE one it's the live booked roster with a Remove action.
  // TASK 7: cancel-session is offered ONLY when the session is in the FUTURE.
  const isFuture = parseInstant(slot.startsAt).getTime() > parseInstant(now).getTime();
  const isPast = !isFuture;

  // Confirmation state (the rule lives ONLY in the @tpa/core predicate).
  const confirmed = isSessionConfirmed(slot);
  const full = slot.bookedCount >= slot.capacity;
  // Capacity-1 sessions (individual/trial) confirm on the first booking, always — a
  // permanent chip is noise and there's nothing to manually confirm, so the whole
  // confirmation UI (chip + button) is suppressed for them.
  const showConfirmState = slot.capacity > 1;
  // Confirm is offered only while the session is still PENDING, FUTURE, published,
  // and manually-confirmable (capacity > 1) — a confirmed/cancelled/past/cap-1
  // session shows no button.
  const canConfirmSession = showConfirmState && !confirmed && isFuture && slot.status === 'published';
  const rosterBookings = isPast
    ? bookingsForSlot(bookings, slot.id)
        .filter((b) => b.status !== 'cancelled')
        .sort((a, b) => new Date(a.bookedAt).getTime() - new Date(b.bookedAt).getTime())
    : activeRoster;
  const attendedCount = rosterBookings.filter((b) => b.status === 'attended').length;
  const noShowCount = rosterBookings.filter((b) => b.status === 'no_show').length;
  const unmarkedCount = rosterBookings.filter((b) => b.status === 'booked').length;
  // "Previously booked" now means players who were REMOVED (cancelled) — the
  // attended/no_show ones live in the roster on a past session.
  const history = bookingsForSlot(bookings, slot.id).filter((b) => b.status === 'cancelled');

  const eyebrow = `${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`;
  const title = `${TRAINING_LABEL[slot.trainingType]} session`;

  // New wall time → UTC instants (all conversion via @tpa/core, DST-correct).
  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const [sh, sm] = startStr.split(':').map(Number);
  const timeValid = dateStr !== '' && startStr !== '' && [yy, mm, dd, sh, sm].every((n) => Number.isFinite(n));
  const { startsAt: newStart, endsAt: newEnd } = timeValid
    ? slotTimesFromWall(yy!, mm!, dd!, sh! * 60 + sm!, durationMin)
    : { startsAt: slot.startsAt, endsAt: slot.endsAt };
  const timeChanged = newStart !== slot.startsAt || newEnd !== slot.endsAt;
  const startMoved = newStart !== slot.startsAt;
  const inPast = startMoved && new Date(newStart).getTime() <= new Date(now).getTime();
  const newWeekday = timeValid ? new Date(Date.UTC(yy!, mm! - 1, dd!)).getUTCDay() : -1;
  const closedDay = newWeekday >= 0 && closedWeekdays(templates).has(newWeekday as Weekday);
  const conflict = timeChanged ? findCoachConflict(slots, coachId, newStart, newEnd, slot.id) : undefined;
  const conflictCoach = coachById(coaches, coachId)?.name ?? 'this coach';

  const capacityTooLow = capacity < occupied;
  const coachChanged = coachId !== slot.coachId;
  const warnCoachChange = coachChanged && occupied > 0;
  const originalCoach = coachById(coaches, slot.coachId)?.name ?? 'the coach';
  const newCoach = coachById(coaches, coachId)?.name ?? 'another coach';

  const canSave = !capacityTooLow && timeValid && !inPast;

  const applyEdit = async () => {
    setActionError(null);
    const res = await updateSlotDetails(slot, { coachId, capacity, startsAt: newStart, endsAt: newEnd }, now);
    if (res.ok) onClose();
    else setActionError(copyFor(res.reason));
  };
  const onSave = () => {
    if (!canSave) return;
    // A move that affects booked players demands an explicit confirm (nobody is
    // auto-notified yet). Coach/capacity-only edits apply straight away.
    if (timeChanged && occupied > 0) {
      setView({ k: 'reschedule' });
      return;
    }
    void applyEdit();
  };

  // ---- ADD view: a searchable roster of bookable players ----
  const book = async (playerId: Player['id'], override: boolean) => {
    setActionError(null);
    const res = await addPlayerToSlot(slot.id, playerId, override);
    if (!res.ok) setActionError(copyFor(res.reason));
  };
  function AddTrailing({ player }: { player: Player }) {
    const credit = usableCreditFor(batches, player.id, slot.trainingType, now);
    const verdict = classifyAdminBooking(
      slot,
      player,
      batchesForPlayer(batches, player.id),
      now,
      isActivelyBooked(bookings, slot.id, player.id),
    );
    return (
      <>
        <span className={styles.credit}>
          {credit} credit{credit === 1 ? '' : 's'}
        </span>
        {verdict.kind === 'ok' ? (
          <Button size="sm" onClick={() => void book(player.id, false)}>
            Book
          </Button>
        ) : verdict.kind === 'override' ? (
          <Button
            size="sm"
            variant="secondary"
            className={styles.overrideBtn}
            title={`${verdict.reason === 'gender_mismatch' ? GENDER_LABEL[player.gender] : LEVEL_LABEL[player.level]} — outside this slot's filter`}
            onClick={() => void book(player.id, true)}
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
        {actionError ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {actionError}
          </p>
        ) : null}
        {/* Deleted accounts are never bookable — exclude them from the add-player search
            (the full `players` list is still used above for booked-name resolution). */}
        <PlayerSearch players={activePlayers(players)} renderTrailing={(p) => <AddTrailing player={p} />} />
      </Modal>
    );
  }

  // ---- REMOVE view: one player, refund vs forfeit ----
  if (view.k === 'remove') {
    const player = playerById(players, view.booking.playerId);
    const onConfirm = async () => {
      setActionError(null);
      const res = await removeBooking(view.booking.id, refund);
      if (res.ok) {
        setView({ k: 'main' });
        setRefund(true);
      } else {
        setActionError(copyFor(res.reason));
      }
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
            <Button variant="destructive" icon={Trash2} onClick={() => void onConfirm()}>
              Remove {player ? player.name.split(' ')[0] : 'player'}
            </Button>
          </>
        }
      >
        <div className={styles.removeHead}>
          <Avatar name={player?.name ?? 'Player'} size={44} />
          <div>
            <p className={styles.removeName}>{player?.name ?? 'Player'}</p>
            <p className={styles.removeSub}>{player?.phone ?? 'No phone'}</p>
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
        {actionError ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {actionError}
          </p>
        ) : null}
      </Modal>
    );
  }

  // ---- CANCEL view: the whole session ----
  if (view.k === 'cancel') {
    const onConfirm = async () => {
      setActionError(null);
      const res = await cancelSession(slot.id);
      if (res.ok) onClose();
      else setActionError(copyFor(res.reason));
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
            <Button variant="destructive" icon={Trash2} onClick={() => void onConfirm()}>
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
        {actionError ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {actionError}
          </p>
        ) : null}
      </Modal>
    );
  }

  // ---- RESCHEDULE view: confirm moving a session that has players in it ----
  if (view.k === 'reschedule') {
    const oldTime = `${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`;
    const newTime = `${formatInstantDate(newStart)} · ${formatInstantTime(newStart)} – ${formatInstantTime(newEnd)}`;
    return (
      <Modal
        open
        onClose={onClose}
        eyebrow={title}
        title="Reschedule session"
        footer={
          <>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setView({ k: 'main' })}>
              Back
            </Button>
            <Button icon={CalendarClock} onClick={() => void applyEdit()}>
              Reschedule anyway
            </Button>
          </>
        }
      >
        <div className={styles.moveRow}>
          <span className={styles.moveOld}>{oldTime}</span>
          <span className={styles.moveArrow}>→</span>
          <span className={styles.moveNew}>{newTime}</span>
        </div>
        <div className={styles.notify}>
          <AlertTriangle size={18} aria-hidden />
          <p>
            <strong>
              {occupied} player{occupied === 1 ? '' : 's'} {occupied === 1 ? 'is' : 'are'} booked.
            </strong>{' '}
            They will NOT be notified automatically — you must message them the new time. If a player
            can’t make it, remove them with a refund: they’re blameless, since the academy moved the
            session.
          </p>
        </div>
        {conflict ? (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {conflictCoach} already coaches {formatInstantTime(conflict.startsAt)} –{' '}
            {formatInstantTime(conflict.endsAt)} — that overlaps, and they can’t be in two places.
          </p>
        ) : null}
        {actionError ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {actionError}
          </p>
        ) : null}
      </Modal>
    );
  }

  // ---- MAIN view ----
  // Confirm a pending session manually (mirrors the other async handlers: awaits a
  // never-throwing seam, surfaces a reason via actionError). The seam self-invalidates
  // the cache, so on success the chip flips to Confirmed with no manual refetch.
  const onConfirmSession = async () => {
    setActionError(null);
    setConfirming(true);
    const res = await confirmSession(slot.id);
    setConfirming(false);
    if (!res.ok) setActionError(copyFor(res.reason));
    // ok (incl. alreadyConfirmed): stay open; the re-derived slot now reads confirmed.
  };

  // TASK 7: only offer Cancel session on a FUTURE session; a past one is for attendance.
  const footer = (
    <>
      {isFuture ? (
        <Button className={styles.cancelBtn} variant="destructive" icon={Ban} onClick={() => setView({ k: 'cancel' })}>
          Cancel session
        </Button>
      ) : null}
      {canConfirmSession ? (
        <Button variant="secondary" icon={Check} disabled={confirming} onClick={() => void onConfirmSession()}>
          {confirming ? 'Confirming…' : 'Confirm session'}
        </Button>
      ) : null}
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
      <Button onClick={onSave} disabled={!canSave}>
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
              {isPast
                ? `${attendedCount} attended · ${noShowCount} no-show${unmarkedCount > 0 ? ` · ${unmarkedCount} unmarked` : ''}`
                : `${occupied} of ${slot.capacity} booked`}
            </p>
            <p className={styles.summarySub}>
              {isPast ? 'Session ended' : TYPE_PLAYERS[slot.trainingType]} · coached by {originalCoach}
            </p>
          </div>
          <div className={styles.pills}>
            {/* Confirmation state — ONE chip carrying both the count and the state.
                Suppressed on cap-1 (always confirms on the first booking). */}
            {showConfirmState ? (
              confirmed ? (
                full ? (
                  <Badge tone="success">Confirmed</Badge>
                ) : (
                  <Badge tone="success">
                    Confirmed · {slot.bookedCount}/{slot.capacity}
                  </Badge>
                )
              ) : (
                <Badge tone="warning">
                  Pending · {slot.bookedCount}/{slot.capacity}
                </Badge>
              )
            ) : null}
            {isGroup ? (
              <>
                <Badge tone="neutral">{GENDER_LABEL[slot.gender!]}</Badge>
                <Badge tone="neutral">{LEVEL_LABEL[slot.level!]}</Badge>
              </>
            ) : null}
          </div>
        </div>

        {/* Roster */}
        <div className={styles.roster}>
          {rosterBookings.map((b) => {
            const player = playerById(players, b.playerId);
            const tags = player && isGroup ? groupTags(player.gender, player.level) : '';
            const setStatus = async (status: AttendanceStatus) => {
              setActionError(null);
              const res = await markAttendance(b.id, status);
              if (!res.ok) setActionError(copyFor(res.reason));
            };
            return (
              <div key={b.id} className={styles.rosterRow}>
                <Avatar name={player?.name ?? 'Player'} size={36} />
                <div className={styles.rosterInfo}>
                  <span className={styles.rosterName}>{player?.name ?? 'Player'}</span>
                  <span className={styles.rosterSub}>
                    {player?.phone ?? 'No phone'}
                    {tags ? ` · ${tags}` : ''}
                  </span>
                </div>
                {isPast ? (
                  <div className={styles.attend}>
                    {/* Toggle: clicking the active state again clears it back to booked. */}
                    <button
                      type="button"
                      className={styles.attendBtn}
                      data-kind="attended"
                      data-on={b.status === 'attended'}
                      aria-pressed={b.status === 'attended'}
                      onClick={() => void setStatus(b.status === 'attended' ? 'booked' : 'attended')}
                    >
                      <Check size={13} aria-hidden />
                      Attended
                    </button>
                    <button
                      type="button"
                      className={styles.attendBtn}
                      data-kind="no_show"
                      data-on={b.status === 'no_show'}
                      aria-pressed={b.status === 'no_show'}
                      onClick={() => void setStatus(b.status === 'no_show' ? 'booked' : 'no_show')}
                    >
                      No-show
                    </button>
                  </div>
                ) : (
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
                )}
              </div>
            );
          })}
          {!isPast &&
            Array.from({ length: emptySeats }, (_, i) => (
              <div key={`empty-${i}`} className={styles.emptySeat}>
                Empty seat
              </div>
            ))}
          {rosterBookings.length === 0 ? (
            <p className={styles.emptyState}>
              {isPast ? 'Nobody was booked on this session.' : 'No seats on this session.'}
            </p>
          ) : null}
        </div>

        {!isPast ? (
          <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setView({ k: 'add' })}>
            Add a player
          </Button>
        ) : null}

        {history.length > 0 ? (
          <div className={styles.history}>
            <button type="button" className={styles.historyToggle} onClick={() => setShowHistory((s) => !s)}>
              Previously booked ({history.length})
            </button>
            {showHistory
              ? history.map((b) => {
                  const player = playerById(players, b.playerId);
                  return (
                    <div key={b.id} className={styles.historyRow}>
                      <span className={styles.historyName}>{player?.name ?? 'Player'}</span>
                      <StatusChip status={b.status} />
                    </div>
                  );
                })
              : null}
          </div>
        ) : null}

        {/* Edit — time */}
        <div className={styles.timeFields}>
          <Input label="Date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          <Input label="Start" type="time" value={startStr} onChange={(e) => setStartStr(e.target.value)} />
          <Select
            label="Duration"
            value={String(durationMin)}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            options={(DURATIONS.some((d) => d.value === durationMin)
              ? DURATIONS
              : [{ value: durationMin, label: `${durationMin} min` }, ...DURATIONS]
            ).map((d) => ({ value: String(d.value), label: d.label }))}
          />
        </div>

        {/* Edit — coach + capacity */}
        <div className={styles.fields}>
          <Select
            label="Coach"
            value={coachId}
            onChange={(e) => setCoachId(e.target.value as CoachId)}
            options={coaches.map((c) => ({ value: c.id, label: c.name }))}
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
        {inPast ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            That start time is in the past — a session can’t have already happened.
          </p>
        ) : null}
        {warnCoachChange ? (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {occupied} player{occupied === 1 ? '' : 's'} booked expecting {originalCoach} — they’ll be
            reassigned to {newCoach}.
          </p>
        ) : null}
        {conflict ? (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {conflictCoach} already coaches {formatInstantTime(conflict.startsAt)} –{' '}
            {formatInstantTime(conflict.endsAt)} — that overlaps.
          </p>
        ) : null}
        {closedDay && !inPast ? (
          <p className={styles.note}>
            <CalendarClock size={15} aria-hidden />
            That’s normally a closed day (Thu–Sat) — allowed for a one-off, but worth a glance.
          </p>
        ) : null}
        {actionError ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {actionError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
