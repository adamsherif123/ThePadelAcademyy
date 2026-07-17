import { cairoWallTimeToInstant, formatInstantTime, formatMonthDay } from '@tpa/core';
import type { SessionSlot } from '@tpa/types';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { layoutDay, slotsForDay, weekColumns, weekHasSlots, weekTimeRange } from '../data/schedule';
import { Button, EmptyState, TRAINING_LABEL } from '../ui';
import { EventCard } from './EventCard';
import styles from './WeekCalendar.module.css';

const WEEKDAY_LABEL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const HOUR_PX = 84;
const OPEN_MIN = 17 * 60; // 5 PM — default the scroll here so the normal view opens on it

export function WeekCalendar({
  now,
  weekOffset,
  onPrevWeek,
  onNextWeek,
  onSlotClick,
  onAddOneOff,
}: {
  now: SessionSlot['startsAt'];
  weekOffset: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onSlotClick: (slot: SessionSlot) => void;
  onAddOneOff: () => void;
}) {
  const columns = weekColumns(now, weekOffset);
  const first = columns[0]!;
  const last = columns[6]!;
  const rangeLabel = `${formatMonthDay(first.dayStart)} – ${formatMonthDay(last.dayStart)}, ${last.date.year}`;
  const hasSlots = weekHasSlots(columns);

  const { startMin, endMin } = weekTimeRange(columns);
  const gridPx = ((endMin - startMin) / 60) * HOUR_PX;
  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, i) => startMin + i * 60);

  // Open scrolled to the operating window (5 PM) so the normal case is what you see.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = ((OPEN_MIN - startMin) / 60) * HOUR_PX;
  }, [startMin, weekOffset]);

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
          <Button icon={Plus} onClick={onAddOneOff}>
            Add one-off slot
          </Button>
        </div>
      </div>

      {hasSlots ? (
        <div className={styles.scroll} ref={scrollRef}>
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

          <div className={styles.grid} style={{ height: gridPx }}>
            <div className={styles.axis}>
              {hours.map((min) => (
                <div key={min} className={styles.axisHour} style={{ height: HOUR_PX }}>
                  <span className={styles.axisLabel}>
                    {formatInstantTime(
                      cairoWallTimeToInstant(first.date.year, first.date.month, first.date.day, min / 60, 0),
                    )}
                  </span>
                </div>
              ))}
            </div>
            {columns.map((col) => (
              <div key={col.weekday} className={styles.dayCol} data-closed={col.isClosed || undefined}>
                {hours.map((min) => (
                  <div key={min} className={styles.gridLine} style={{ height: HOUR_PX }} />
                ))}
                {col.isClosed ? (
                  <div className={styles.closed}>
                    <span className={styles.closedLabel}>CLOSED</span>
                  </div>
                ) : (
                  layoutDay(slotsForDay(col.dayStart), startMin, HOUR_PX, gridPx).map((p) => (
                    <EventCard
                      key={p.slot.id}
                      slot={p.slot}
                      lanes={p.lanes}
                      style={{
                        top: p.top,
                        height: p.height,
                        insetInlineStart: `calc(${p.leftPct}% + 2px)`,
                        width: `calc(${p.widthPct}% - 4px)`,
                      }}
                      onClick={() => onSlotClick(p.slot)}
                    />
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Plus}
          title="No sessions this week"
          message="Nothing is scheduled. Generate slots from your recurring sessions, or add a one-off slot."
        />
      )}
    </div>
  );
}
