import type { Booking, Coach, IsoInstant, SessionSlot } from '@tpa/types';
import { CalendarDays, Clock, Pencil, Plus, Star, Users } from 'lucide-react';
import { useState } from 'react';

import { CoachModal } from '../coaches/CoachModal';
import { coachWeekStats } from '../data/coaches';
import {
  cairoMonthOf,
  isCurrentCairoMonth,
  monthChoices,
  monthKey,
  monthLabel,
  monthNameOnly,
  monthOptions,
  parseMonthKey,
} from '../data/months';
import { useAdminData, useCoachHours } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { Avatar, Badge, Button, ErrorView, LoadingView, PageHeader, Select, trainingLabelFor } from '../ui';
import styles from './Coaches.module.css';

/**
 * Coaches route: one card per coach with query-computed stats + add/edit.
 *
 * ── the month picker is for payroll ──
 * Hours coached is the figure somebody is paid against, and it is asked about
 * AFTER the month ends. The RPC has always taken a p_month; the page just never
 * offered it, so answering "what did Aly do in August" meant going to the database.
 * The picker defaults to this month and sends no argument for it, which is the
 * exact request the page has always made — a past month is a second, different
 * request, made only when one is chosen.
 *
 * Only the hours stat follows the month. Sessions/wk, seats booked and attendance
 * are this-week figures from the slots already in hand, and a week has no sensible
 * reading inside a month you are no longer in.
 */
export function Coaches() {
  const { now } = useSession();
  const data = useAdminData();
  const [editing, setEditing] = useState<Coach | 'new' | null>(null);
  // null = this month, which keeps the default request identical to the old one
  // and survives the page being left open across midnight on the 1st.
  const [picked, setPicked] = useState<string | null>(null);
  const selectedMonth = (picked === null ? null : parseMonthKey(picked)) ?? cairoMonthOf(now);

  // Hours coached is a SEPARATE lightweight query (the SQL aggregate) — never
  // folded into useAdminData's monolith, and never summed client-side.
  const hoursQ = useCoachHours(picked);

  if (data.isPending || hoursQ.isPending) return <LoadingView />;
  if (data.isError || hoursQ.isError) {
    return <ErrorView onRetry={() => { data.refetch(); hoursQ.refetch(); }} />;
  }

  const coaches = data.coaches;
  const hoursByCoach = hoursQ.data ?? {};
  // How far back to offer: the academy's first published session. The slots are
  // already loaded for the week stats, so this costs nothing — and it means the
  // list stops at the month the academy actually started rather than running back
  // through empty years.
  const earliestSlot = data.slots.reduce<IsoInstant | null>(
    (oldest, s) => (oldest === null || s.startsAt < oldest ? s.startsAt : oldest),
    null,
  );
  const months = monthChoices(earliestSlot, now);
  const hoursLabel = isCurrentCairoMonth(selectedMonth, now)
    ? 'Hours this month'
    : `Hours · ${monthNameOnly(selectedMonth)}`;
  // keepPreviousData holds the old month's hours on screen while the new month
  // loads, so the number is dimmed rather than shown under the new month's name.
  const hoursLoading = hoursQ.isFetching;

  return (
    <div>
      <div className={styles.head}>
        <PageHeader
          eyebrow="Team"
          title="Coaches"
          subtitle="The people who run every session on court. Recurring sessions and one-off slots are assigned to these coaches."
        />
        <div className={styles.headControls}>
          <Select
            label="Hours for"
            value={monthKey(selectedMonth)}
            onChange={(e) => setPicked(e.target.value)}
            options={monthOptions(months)}
          />
          <Button icon={Plus} onClick={() => setEditing('new')}>
            Add coach
          </Button>
        </div>
      </div>

      {/* Said once, above the grid, rather than on all four cards. The hours
          figure counts sessions that have ENDED, so the current month's number is
          a month in progress — which is exactly why payroll asks about a finished
          one. */}
      <p className={styles.hoursNote}>
        {isCurrentCairoMonth(selectedMonth, now)
          ? 'Hours are for this month so far — only sessions that have already finished count.'
          : `Hours are for ${monthLabel(selectedMonth)}. Everything else on these cards is this week.`}
      </p>

      <div className={styles.grid}>
        {coaches.map((coach) => (
          <CoachCard
            key={coach.id}
            coach={coach}
            slots={data.slots}
            bookings={data.bookings}
            now={now}
            hoursCoached={hoursByCoach[coach.id] ?? 0}
            hoursLabel={hoursLabel}
            hoursLoading={hoursLoading}
            onEdit={() => setEditing(coach)}
          />
        ))}
      </div>

      {editing ? (
        <CoachModal coach={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function CoachCard({
  coach,
  slots,
  bookings,
  now,
  hoursCoached,
  hoursLabel,
  hoursLoading,
  onEdit,
}: {
  coach: Coach;
  slots: SessionSlot[];
  bookings: Booking[];
  now: IsoInstant;
  hoursCoached: number;
  /** Named by the caller so all four cards agree which month the number is for. */
  hoursLabel: string;
  /** The figure on screen is still the previous month's — dim it. */
  hoursLoading: boolean;
  onEdit: () => void;
}) {
  const stats = coachWeekStats(slots, bookings, coach.id, now);

  return (
    <div className={styles.card} data-inactive={!coach.isActive}>
      <div className={styles.top}>
        <Avatar name={coach.name} photoUrl={coach.photoUrl} size={56} />
        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{coach.name}</span>
          </div>
          <span className={styles.bio}>{coach.bio}</span>
        </div>
        <div className={styles.headEnd}>
          <Badge tone={coach.isActive ? 'success' : 'warning'}>
            {coach.isActive ? 'Active' : 'On leave'}
          </Badge>
          <button type="button" className={styles.editBtn} aria-label={`Edit ${coach.name}`} onClick={onEdit}>
            <Pencil size={15} aria-hidden />
          </button>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <CalendarDays className={styles.statIcon} size={16} aria-hidden />
          <span className={styles.statValue}>{stats.sessionsThisWeek}</span>
          <span className={styles.statLabel}>Sessions / wk</span>
        </div>
        <div className={styles.stat}>
          <Users className={styles.statIcon} size={16} aria-hidden />
          <span className={styles.statValue}>{stats.seatsBooked}</span>
          <span className={styles.statLabel}>Seats booked</span>
        </div>
        <div className={styles.stat}>
          <Star className={styles.statIcon} size={16} aria-hidden />
          <span className={styles.statValue}>{stats.attendancePct === null ? '—' : `${stats.attendancePct}%`}</span>
          <span className={styles.statLabel}>Attendance</span>
        </div>
        <div
          className={[styles.stat, hoursLoading ? styles.statLoading : ''].join(' ').trim()}
          aria-busy={hoursLoading}
        >
          <Clock className={styles.statIcon} size={16} aria-hidden />
          <span className={styles.statValue}>{hoursCoached.toFixed(1)}</span>
          <span className={styles.statLabel}>{hoursLabel}</span>
        </div>
      </div>

      <div className={styles.week}>
        {stats.typeCounts.length > 0 ? (
          <>
            <span className={styles.weekLabel}>This week</span>
            {stats.typeCounts.map((c) => (
              <span key={c.type ?? 'open'} className={styles.chip}>
                {c.count}× {trainingLabelFor(c.type)}
              </span>
            ))}
          </>
        ) : (
          <span className={styles.weekEmpty}>No sessions scheduled this week.</span>
        )}
      </div>
    </div>
  );
}
