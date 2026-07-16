import { cairoWallTimeToInstant, formatInstantTime, formatMonthDay, parseInstant } from '@tpa/core';
import type { SessionSlot } from '@tpa/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import { cairoWallMinutes, slotsForDay, weekColumns, weekHasSlots } from '../data/schedule';
import { assignLanes } from '../data/lanes';
import { coachById } from '../data/selectors';
import { Button, EmptyState, TRAINING_LABEL, groupTags } from '../ui';
import styles from './WeekCalendar.module.css';

const WEEKDAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const START_MIN = 17 * 60; // 5 PM — the academy opens
const END_MIN = 23 * 60; // 11 PM — closes
const HOUR_PX = 92;
const ms = (i: SessionSlot['startsAt']) => parseInstant(i).getTime();

/** Hour labels down the axis: 5 PM … 10 PM (the 11 PM line closes the grid). */
const HOURS = Array.from({ length: (END_MIN - START_MIN) / 60 }, (_, i) => START_MIN + i * 60);

function EventCard({ slot, onClick }: { slot: SessionSlot; onClick: () => void }) {
  const startMin = cairoWallMinutes(slot.startsAt);
  const endMin = cairoWallMinutes(slot.endsAt);
  const coach = coachById(slot.coachId);
  const full = slot.bookedCount >= slot.capacity;
  const tags = groupTags(slot.gender, slot.level);
  return (
    <button
      type="button"
      className={styles.event}
      data-type={slot.trainingType}
      style={{
        top: ((startMin - START_MIN) / 60) * HOUR_PX,
        height: Math.max(28, ((endMin - startMin) / 60) * HOUR_PX - 2),
      }}
      onClick={onClick}
    >
      <span className={styles.eventTop}>
        <span className={styles.eventTime}>{formatInstantTime(slot.startsAt)}</span>
        <span className={styles.cap} data-full={full || undefined}>
          {slot.bookedCount}/{slot.capacity}
        </span>
      </span>
      <span className={styles.eventCoach}>{coach ? coach.name.split(' ')[0] : TRAINING_LABEL[slot.trainingType]}</span>
      <span className={styles.eventTags}>{tags || TRAINING_LABEL[slot.trainingType]}</span>
    </button>
  );
}

export function WeekCalendar({
  now,
  weekOffset,
  onPrevWeek,
  onNextWeek,
  onSlotClick,
}: {
  now: SessionSlot['startsAt'];
  weekOffset: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSlotClick: (slot: SessionSlot) => void;
}) {
  const columns = weekColumns(now, weekOffset);
  const first = columns[0]!;
  const last = columns[6]!;
  const rangeLabel = `${formatMonthDay(first.dayStart)} – ${formatMonthDay(last.dayStart)}, ${last.date.year}`;
  const hasSlots = weekHasSlots(columns);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} aria-label="Previous week" onClick={onPrevWeek}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <button type="button" className={styles.navBtn} aria-label="Next week" onClick={onNextWeek}>
            <ChevronRight size={18} aria-hidden />
          </button>
          <div className={styles.range}>
            <span className={styles.rangeLabel}>{rangeLabel}</span>
            {weekOffset === 0 ? <span className={styles.rangeSub}>This week</span> : null}
          </div>
        </div>
        <div className={styles.headerEnd}>
          <ul className={styles.legend}>
            {(['group', 'duo', 'individual', 'trial'] as const).map((t) => (
              <li key={t} className={styles.legendItem}>
                <span className={styles.legendDot} data-type={t} />
                {TRAINING_LABEL[t]}
              </li>
            ))}
          </ul>
          <Button icon={Plus} disabled title="Add one-off slot (S4d)">
            Add one-off slot
          </Button>
        </div>
      </div>

      <div className={styles.dayHeads}>
        <div className={styles.axisSpacer} />
        {columns.map((col) => (
          <div key={col.weekday} className={styles.dayHead}>
            <span className={styles.dayName}>{WEEKDAY_LABEL[col.weekday]}</span>
            <span className={styles.dayNum} data-today={col.isToday || undefined}>
              {col.date.day}
            </span>
          </div>
        ))}
      </div>

      {hasSlots ? (
        <div className={styles.grid}>
          <div className={styles.axis}>
            {HOURS.map((min) => (
              <div key={min} className={styles.axisHour} style={{ height: HOUR_PX }}>
                <span className={styles.axisLabel}>
                  {formatInstantTime(
                    cairoWallTimeToInstant(first.date.year, first.date.month, first.date.day, min / 60, 0),
                  )}
                </span>
              </div>
            ))}
          </div>
          {columns.map((col) => {
            const slots = slotsForDay(col.dayStart);
            const placed = assignLanes(slots, (s) => ({ startMs: ms(s.startsAt), endMs: ms(s.endsAt) }));
            return (
              <div key={col.weekday} className={styles.dayCol} data-closed={col.isClosed || undefined}>
                {HOURS.map((min) => (
                  <div key={min} className={styles.gridLine} style={{ height: HOUR_PX }} />
                ))}
                {col.isClosed ? (
                  <div className={styles.closed}>
                    <span className={styles.closedLabel}>CLOSED</span>
                  </div>
                ) : (
                  placed.map(({ item, lane, lanes }) => (
                    <div
                      key={item.id}
                      className={styles.laneWrap}
                      style={{ insetInlineStart: `${(lane / lanes) * 100}%`, width: `${(1 / lanes) * 100}%` }}
                    >
                      <EventCard slot={item} onClick={() => onSlotClick(item)} />
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Plus}
          title="No sessions this week"
          message="Nothing is scheduled. Generate slots from the availability templates, or add a one-off slot."
        />
      )}
    </div>
  );
}
