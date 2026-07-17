import type { Booking, Coach, IsoInstant, SessionSlot } from '@tpa/types';
import { CalendarDays, Pencil, Plus, Star, Users } from 'lucide-react';
import { useState } from 'react';

import { CoachModal } from '../coaches/CoachModal';
import { coachWeekStats } from '../data/coaches';
import { useAdminData } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { Avatar, Badge, Button, ErrorView, LoadingView, PageHeader, TRAINING_LABEL } from '../ui';
import styles from './Coaches.module.css';

/** Coaches route: one card per coach with query-computed stats + add/edit. */
export function Coaches() {
  const { now } = useSession();
  const data = useAdminData();
  const [editing, setEditing] = useState<Coach | 'new' | null>(null);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  const coaches = data.coaches;

  return (
    <div>
      <div className={styles.head}>
        <PageHeader
          eyebrow="Team"
          title="Coaches"
          subtitle="The people who run every session on court. Recurring sessions and one-off slots are assigned to these coaches."
        />
        <Button icon={Plus} onClick={() => setEditing('new')}>
          Add coach
        </Button>
      </div>

      <div className={styles.grid}>
        {coaches.map((coach) => (
          <CoachCard
            key={coach.id}
            coach={coach}
            slots={data.slots}
            bookings={data.bookings}
            now={now}
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
  onEdit,
}: {
  coach: Coach;
  slots: SessionSlot[];
  bookings: Booking[];
  now: IsoInstant;
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
      </div>

      <div className={styles.week}>
        {stats.typeCounts.length > 0 ? (
          <>
            <span className={styles.weekLabel}>This week</span>
            {stats.typeCounts.map((c) => (
              <span key={c.type} className={styles.chip}>
                {c.count}× {TRAINING_LABEL[c.type]}
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
