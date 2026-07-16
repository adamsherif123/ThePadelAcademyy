import { formatInstantDate, formatInstantTime } from '@tpa/core';
import type { CoachId, SessionSlot } from '@tpa/types';
import { AlertTriangle, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { cancelSession } from '../data/cancelSession';
import { allCoaches, coachById } from '../data/selectors';
import { updateSlotDetails } from '../data/slots';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Button,
  GENDER_LABEL,
  Input,
  LEVEL_LABEL,
  Modal,
  Select,
  TRAINING_LABEL,
  TYPE_PLAYERS,
} from '../ui';
import styles from './SlotModal.module.css';

/**
 * The slot detail modal. Edits coach/capacity (Save), or cancels the session
 * (refunding every booked player). Two guards v0 skipped:
 *  - capacity below bookedCount is impossible → Save is blocked with a reason;
 *  - changing the coach on a booked slot is allowed but WARNED (players booked
 *    expecting someone else).
 * Cancelling is deliberate: a confirm step states how many players are refunded.
 */
export function SlotModal({ slot, onClose }: { slot: SessionSlot; onClose: () => void }) {
  const { now } = useSession();
  const isGroup = slot.gender !== null && slot.level !== null;

  const [coachId, setCoachId] = useState<CoachId>(slot.coachId);
  const [capacity, setCapacity] = useState<number>(slot.capacity);
  const [confirming, setConfirming] = useState(false);

  const eyebrow = `${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`;
  const title = `${TRAINING_LABEL[slot.trainingType]} session`;

  const capacityTooLow = capacity < slot.bookedCount;
  const coachChanged = coachId !== slot.coachId;
  const warnCoachChange = coachChanged && slot.bookedCount > 0;
  const originalCoach = coachById(slot.coachId)?.name ?? 'the coach';
  const newCoach = coachById(coachId)?.name ?? 'another coach';

  const onSave = () => {
    if (capacityTooLow) return;
    updateSlotDetails(slot.id, coachId, capacity);
    onClose();
  };

  const onConfirmCancel = () => {
    cancelSession(slot.id, now);
    onClose();
  };

  const footer = confirming ? (
    <>
      <Button variant="secondary" onClick={() => setConfirming(false)}>
        Back
      </Button>
      <Button variant="destructive" icon={Trash2} onClick={onConfirmCancel}>
        Cancel session &amp; refund
      </Button>
    </>
  ) : (
    <>
      <Button className={styles.cancelBtn} variant="destructive" icon={Trash2} onClick={() => setConfirming(true)}>
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
      {confirming ? (
        <div className={styles.confirm}>
          <div className={styles.confirmIcon}>
            <AlertTriangle size={22} aria-hidden />
          </div>
          <p className={styles.confirmTitle}>Cancel this session?</p>
          <p className={styles.confirmBody}>
            {slot.bookedCount === 0
              ? 'No players are booked. The session will be removed from the schedule.'
              : `All ${slot.bookedCount} booked player${slot.bookedCount === 1 ? '' : 's'} will be refunded to their original credit — regardless of the 3-hour window, since the academy is cancelling.`}
          </p>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.summary}>
            <span className={styles.summaryIcon}>
              <Users size={20} aria-hidden />
            </span>
            <div>
              <p className={styles.summaryTitle}>
                {slot.bookedCount} of {slot.capacity} booked
              </p>
              <p className={styles.summarySub}>
                {TYPE_PLAYERS[slot.trainingType]} · coached by {originalCoach}
              </p>
            </div>
          </div>

          {isGroup ? (
            <div className={styles.pills}>
              <Badge tone="neutral">{GENDER_LABEL[slot.gender!]}</Badge>
              <Badge tone="neutral">{LEVEL_LABEL[slot.level!]}</Badge>
            </div>
          ) : null}

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
            <p className={styles.error}>
              Capacity can’t be below the {slot.bookedCount} already booked.
            </p>
          ) : null}
          {warnCoachChange ? (
            <p className={styles.warn}>
              <AlertTriangle size={15} aria-hidden />
              {slot.bookedCount} player{slot.bookedCount === 1 ? '' : 's'} booked expecting{' '}
              {originalCoach} — they’ll be reassigned to {newCoach}.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
