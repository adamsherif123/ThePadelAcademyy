import {
  cairoCalendarDate,
  creditExpiryState,
  formatExpiry,
  formatInstantDate,
  formatInstantTime,
  formatPiastres,
} from '@tpa/core';
import type {
  Coach,
  CreditBatch,
  IsoInstant,
  Package,
  Player,
  Purchase,
  SessionSlot,
  TrainingType,
} from '@tpa/types';
import { AlertTriangle, CalendarCheck, DollarSign, Gauge, Users, Wallet } from 'lucide-react';

import {
  activePlayerCount,
  creditLiability,
  creditsExpiringSoon,
  recentPurchases,
  revenueByType,
  revenueOverTime,
  revenueThisMonth,
  sessionsThisWeek,
  slotFillRate,
  todaysSessions,
} from '../data/dashboard';
import { coachById, packageById, playerById } from '../data/selectors';
import { useAdminData } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  Badge,
  Donut,
  EmptyState,
  ErrorView,
  LineChart,
  LoadingView,
  PageHeader,
  Panel,
  StatCard,
  TRAINING_LABEL,
  TypePill,
  type DonutSegment,
} from '../ui';
import styles from './Dashboard.module.css';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Donut colours = trainingTint, so training type has ONE colour meaning across
 * the admin (the calendar uses the same). The owner shouldn't relearn the
 * encoding per screen. (v0's blue-scale here was aesthetic; ours is semantic.)
 */
const DONUT_COLOR: Record<TrainingType, string> = {
  group: 'var(--tint-group-fg)',
  duo: 'var(--tint-duo-fg)',
  individual: 'var(--tint-individual-fg)',
  trial: 'var(--tint-trial-fg)',
};

/** "expires in 2 days" → "In 2 days" for the compact urgency chip. */
function shortExpiry(expiresAt: IsoInstant, now: IsoInstant): string {
  const s = formatExpiry(expiresAt, now).replace(/^expires /, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function SessionRow({ slot, coaches }: { slot: SessionSlot; coaches: Coach[] }) {
  const full = slot.bookedCount >= slot.capacity;
  return (
    <div className={styles.row}>
      <div className={styles.timeCol}>
        <span className={styles.time}>{formatInstantTime(slot.startsAt)}</span>
        <span className={styles.sub}>
          {formatInstantTime(slot.startsAt)}–{formatInstantTime(slot.endsAt)}
        </span>
      </div>
      <div className={styles.midCol}>
        <TypePill type={slot.trainingType} />
        <span className={styles.sub}>{coachById(coaches, slot.coachId)?.name ?? 'Coach'}</span>
      </div>
      <Badge tone={full ? 'danger' : 'neutral'}>
        {slot.bookedCount}/{slot.capacity}
      </Badge>
    </div>
  );
}

function ExpiringRow({ batch, players, now }: { batch: CreditBatch; players: Player[]; now: IsoInstant }) {
  const player = playerById(players, batch.playerId);
  const tone = creditExpiryState(batch.expiresAt, now) === 'expiring_soon' ? 'warning' : 'neutral';
  return (
    <div className={styles.row}>
      <AlertTriangle className={styles.warn} size={18} aria-hidden />
      <div className={styles.midCol}>
        <span className={styles.name}>{player?.name ?? 'Player'}</span>
        <span className={styles.sub}>
          {batch.quantityRemaining} × {TRAINING_LABEL[batch.trainingType]}
        </span>
      </div>
      <Badge tone={tone}>{shortExpiry(batch.expiresAt, now)}</Badge>
    </div>
  );
}

function PurchaseRow({
  purchase,
  players,
  packages,
}: {
  purchase: Purchase;
  players: Player[];
  packages: Package[];
}) {
  const player = playerById(players, purchase.playerId);
  const pkg = packageById(packages, purchase.packageId);
  return (
    <div className={styles.row}>
      <div className={styles.midCol}>
        <span className={styles.name}>{player?.name ?? 'Player'}</span>
        <span className={styles.sub}>
          {pkg ? `${pkg.sessionCount} × ${TRAINING_LABEL[pkg.trainingType]}` : '—'}
        </span>
      </div>
      <div className={styles.endCol}>
        <span className={styles.amount}>{formatPiastres(purchase.amount)}</span>
        <span className={styles.sub}>{formatInstantDate(purchase.createdAt)}</span>
      </div>
    </div>
  );
}

/** Dashboard — every figure computed from the store via pure (…, now) aggregates. */
export function Dashboard() {
  const { now } = useSession();
  const data = useAdminData();
  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  const cNow = cairoCalendarDate(now);
  const monthName = MONTHS[cNow.month - 1] ?? '';
  const rev = revenueThisMonth(data.purchases, now);
  const rbt = revenueByType(data.purchases, data.packages);
  const line = revenueOverTime(data.purchases, now).map((b) => ({ label: b.label, value: b.revenue }));
  const donutSegments: DonutSegment[] = rbt.rows.map((r) => ({
    key: r.type,
    label: TRAINING_LABEL[r.type],
    value: r.amount,
    color: DONUT_COLOR[r.type],
  }));

  const today = todaysSessions(data.slots, now);
  const expiring = creditsExpiringSoon(data.batches, now, 7);
  const recent = recentPurchases(data.purchases, 4);

  return (
    <div>
      <PageHeader
        eyebrow="Good morning, Rania"
        title="Dashboard"
        subtitle="The state of The Padel Academy — revenue, players, sessions, and what needs your attention today."
      />

      <div className={styles.kpis}>
        <StatCard
          eyebrow={`Revenue · ${monthName}`}
          icon={DollarSign}
          iconTone="accent"
          value={formatPiastres(rev.current)}
          delta={rev.deltaPct}
          caption="vs last month"
        />
        <StatCard eyebrow="Active players" icon={Users} value={String(activePlayerCount(data.batches, data.bookings, now))} caption="with credits or bookings" />
        <StatCard eyebrow="Sessions this week" icon={CalendarCheck} value={String(sessionsThisWeek(data.slots, now))} caption="booked, Sun–Wed" />
        <StatCard eyebrow="Slot fill rate" icon={Gauge} value={`${slotFillRate(data.slots, now)}%`} caption="capacity booked this week" />
        <StatCard eyebrow="Credit liability" icon={Wallet} value={formatPiastres(creditLiability(data.batches, data.purchases, now))} caption="sold, not yet used" />
      </div>

      <div className={styles.charts}>
        <Panel eyebrow="Last 8 weeks" title="Revenue over time">
          <LineChart data={line} />
        </Panel>
        <Panel eyebrow="What earns" title="Revenue by training type">
          <Donut segments={donutSegments} total={rbt.total} />
        </Panel>
      </div>

      <div className={styles.bottom}>
        <Panel eyebrow="Live" title="Today's sessions" link={{ label: 'Schedule', to: '/schedule' }}>
          {today.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No sessions today" message="The academy is closed or nothing is scheduled for today." />
          ) : (
            <div className={styles.list}>
              {today.map((slot) => (
                <SessionRow key={slot.id} slot={slot} coaches={data.coaches} />
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Next 7 days" title="Credits expiring soon" link={{ label: 'Players', to: '/players' }}>
          {expiring.length === 0 ? (
            <EmptyState icon={Wallet} title="Nothing expiring" message="No credits lapse in the next 7 days." />
          ) : (
            <div className={styles.list}>
              {expiring.slice(0, 5).map((batch) => (
                <ExpiringRow key={batch.id} batch={batch} players={data.players} now={now} />
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Latest sales" title="Recent purchases" link={{ label: 'Packages', to: '/packages' }}>
          <div className={styles.list}>
            {recent.map((purchase) => (
              <PurchaseRow key={purchase.id} purchase={purchase} players={data.players} packages={data.packages} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
