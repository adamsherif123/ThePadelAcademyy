import { formatInstantTime, formatMonthDay, isSessionConfirmed } from '@tpa/core';
import type { Coach, SessionSlot } from '@tpa/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import type { DayColumn } from '../data/schedule';
import { slotsForDay } from '../data/schedule';
import { coachById } from '../data/selectors';
import { Button, EmptyState, groupTags, trainingLabelFor } from '../ui';
import styles from './DayCalendar.module.css';

const WEEKDAY_SHORT = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The mobile face of the schedule: ONE day at a time, as a readable list.
 *
 * A 7-day × time grid at 375px gives ~41px columns — not a layout problem to solve
 * but the wrong shape for the screen, so below the breakpoint the same week data is
 * presented a day at a time instead. Desktop keeps WeekCalendar untouched.
 *
 * Everything here is derived from the SAME `columns` (weekColumns) and `slots` the
 * week grid reads — no separate query, no separate slot logic. Tapping a session
 * opens the very same SlotModal the grid opens.
 */
export function DayCalendar({
  columns,
  selectedIndex,
  slots,
  coaches,
  onPrevDay,
  onNextDay,
  onSelectDay,
  onSlotClick,
  onAddOneOff,
}: {
  /** The Sun–Sat columns of the week containing the selected day. */
  columns: DayColumn[];
  /** Which of those 7 columns is selected (0–6). */
  selectedIndex: number;
  slots: SessionSlot[];
  coaches: Coach[];
  onPrevDay: () => void;
  onNextDay: () => void;
  onSelectDay: (index: number) => void;
  onSlotClick: (slot: SessionSlot) => void;
  onAddOneOff: () => void;
}) {
  const selected = columns[selectedIndex]!;
  const daySlots = slotsForDay(slots, selected.dayStart);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button type="button" className={styles.navBtn} aria-label="Previous day" onClick={onPrevDay}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div className={styles.headTitle}>
          <span className={styles.headDate}>{formatMonthDay(selected.dayStart)}</span>
          <span className={styles.headSub}>
            {selected.isToday ? 'Today' : `${selected.date.year}`}
          </span>
        </div>
        <button type="button" className={styles.navBtn} aria-label="Next day" onClick={onNextDay}>
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {/* The week the selected day sits in, as a tappable strip — a day is one tap
          away, and stepping past either end rolls into the next week on its own. */}
      <div className={styles.strip} role="tablist" aria-label="Day of week">
        {columns.map((col, i) => (
          <button
            key={col.dayStart}
            type="button"
            role="tab"
            aria-selected={i === selectedIndex}
            className={styles.stripDay}
            data-selected={i === selectedIndex || undefined}
            data-today={col.isToday || undefined}
            data-closed={col.isClosed || undefined}
            onClick={() => onSelectDay(i)}
          >
            <span className={styles.stripName}>{WEEKDAY_SHORT[col.weekday]}</span>
            <span className={styles.stripNum}>{col.date.day}</span>
            {slotsForDay(slots, col.dayStart).length > 0 ? <span className={styles.stripDot} /> : null}
          </button>
        ))}
      </div>

      <Button className={styles.addBtn} icon={Plus} onClick={onAddOneOff}>
        Add session this day
      </Button>

      {daySlots.length > 0 ? (
        <div className={styles.list}>
          {daySlots.map((slot) => (
            <SlotRow key={slot.id} slot={slot} coaches={coaches} onClick={() => onSlotClick(slot)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Plus}
          title={selected.isClosed ? 'Closed this day' : 'No sessions this day'}
          message={
            selected.isClosed
              ? 'The academy has no recurring sessions on this weekday. You can still add a one-off.'
              : 'Nothing is scheduled. Add a one-off session, or generate slots from your recurring sessions.'
          }
        />
      )}
    </div>
  );
}

/**
 * One session as a full-width row. Carries the same facts EventCard shows in the grid
 * — time, capacity, type/tags, coach — but without the density-dropping, since there's
 * no lane crowding here: the whole width is one session's.
 */
function SlotRow({ slot, coaches, onClick }: { slot: SessionSlot; coaches: Coach[]; onClick: () => void }) {
  const coach = coachById(coaches, slot.coachId);
  const full = slot.bookedCount >= slot.capacity;
  const pending = slot.capacity > 1 && !isSessionConfirmed(slot);
  const tags = groupTags(slot.gender, slot.level);

  return (
    <button type="button" className={styles.slot} data-type={slot.trainingType ?? 'open'} onClick={onClick}>
      <span className={styles.slotBar} aria-hidden />
      <span className={styles.slotBody}>
        <span className={styles.slotTop}>
          <span className={styles.slotTime}>
            {formatInstantTime(slot.startsAt)} – {formatInstantTime(slot.endsAt)}
          </span>
          <span className={styles.slotCap} data-full={full || undefined} data-pending={pending || undefined}>
            {slot.bookedCount}/{slot.capacity}
          </span>
        </span>
        <span className={styles.slotType}>{trainingLabelFor(slot.trainingType)}</span>
        <span className={styles.slotMeta}>
          {coach?.name ?? 'Unassigned'}
          {tags ? ` · ${tags}` : ''}
        </span>
      </span>
    </button>
  );
}
