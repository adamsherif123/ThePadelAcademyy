import { formatHour, formatInstantTime, isSessionConfirmed } from '@tpa/core';
import type { Coach, SessionSlot } from '@tpa/types';
import type { CSSProperties } from 'react';

import { cairoWallMinutes } from '../data/schedule';
import { coachById } from '../data/selectors';
import { TRAINING_LABEL, groupTags } from '../ui';
import styles from './EventCard.module.css';

/**
 * A calendar event card. It IS the positioned box — the caller passes the full
 * geometry (top/height from the time, inset-inline-start/width from the lane) as
 * `style`; there is no separate wrapper. Density follows the lane count, dropping
 * content by a fixed priority as it narrows: capacity (never truncates) > start
 * time > coach > gender/level tags.
 */
export function EventCard({
  slot,
  coaches = [],
  lanes,
  style,
  onClick,
}: {
  slot: SessionSlot;
  /** Optional so the design gallery can render a tile without the dataset; the live
   * calendar always passes the real array, so coach names resolve there. */
  coaches?: Coach[];
  lanes: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const startMin = cairoWallMinutes(slot.startsAt);
  const timeLabel = startMin % 60 === 0 ? formatHour(slot.startsAt) : formatInstantTime(slot.startsAt);
  const coach = coachById(coaches, slot.coachId);
  const full = slot.bookedCount >= slot.capacity;
  // Pending = not yet confirmed (hasn't filled and no manual confirm). A subtle dot
  // on the capacity pill lets Rania scan which sessions still need players. Cap-1
  // sessions (individual/trial) confirm on the first booking, so they never show it.
  const pending = slot.capacity > 1 && !isSessionConfirmed(slot);
  const tags = groupTags(slot.gender, slot.level) || TRAINING_LABEL[slot.trainingType];

  const density = Math.min(lanes, 3); // 1 = full, 2 = half, 3 = third (or narrower)
  const showCoach = density <= 2; // dropped at 1/3
  const showTags = density === 1; // first to go; the tint + legend carry the type

  return (
    <button
      type="button"
      className={styles.event}
      data-type={slot.trainingType}
      data-lanes={density}
      style={style}
      onClick={onClick}
    >
      <span className={styles.top}>
        <span className={styles.time}>{timeLabel}</span>
        <span
          className={styles.cap}
          data-full={full || undefined}
          data-pending={pending || undefined}
          title={slot.capacity > 1 ? (pending ? 'Pending — not yet filled' : 'Confirmed') : undefined}
        >
          {slot.bookedCount}/{slot.capacity}
        </span>
      </span>
      {showCoach ? (
        <span className={styles.coach}>{coach ? coach.name.split(' ')[0] : TRAINING_LABEL[slot.trainingType]}</span>
      ) : null}
      {showTags ? <span className={styles.tags}>{tags}</span> : null}
    </button>
  );
}
