import {
  creditExpiryState,
  formatExpiry,
  formatInstantDate,
  formatInstantTime,
  formatPiastres,
  isSessionConfirmed,
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
import { useState } from 'react';

import {
  atLocation,
  activePlayersAtLocation,
  creditsExpiringSoon,
  purchasesWithin,
  recentPurchases,
  revenueByType,
  revenueOverTime,
  revenueThisMonth,
  sessionsThisWeek,
  slotFillRate,
  todaysSessions,
} from '../data/dashboard';
import { ALL_LOCATIONS, locationFilterOptions, type LocationFilter } from '../data/locations';
import {
  cairoMonthOf,
  chartAnchorFor,
  isCurrentCairoMonth,
  monthChoices,
  monthFetchRange,
  monthKey,
  monthLabel,
  monthOptions,
  monthRange,
  monthStartInstant,
  parseMonthKey,
} from '../data/months';
import { coachById, packageById, playerById } from '../data/selectors';
import {
  combine,
  useBatches,
  useBookings,
  useCoaches,
  useEarliestPurchase,
  useLocations,
  usePackages,
  usePlayers,
  usePurchasesInRange,
  useSlots,
} from '../data/queries';
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
  Select,
  StatCard,
  TRAINING_LABEL,
  TypePill,
  type DonutSegment,
} from '../ui';
import styles from './Dashboard.module.css';


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
  // The dashboard is where this belongs: "Today's sessions" is Rania's at-a-glance
  // ops list, and the one thing she acts on each evening is which sessions HAVEN'T
  // filled yet (pending) versus which are locked in (confirmed) — so each row leads
  // with that state rather than a bare seat count.
  const confirmed = isSessionConfirmed(slot);
  const full = slot.bookedCount >= slot.capacity;
  // Cap-1 sessions (individual/trial) confirm on the first booking, so a confirmation
  // tag is noise — they carry no state tag here. Cap>1 gets ONE chip that is both the
  // count and the state.
  const showConfirmState = slot.capacity > 1;
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
        {purchase.paid ? null : <span className={styles.unpaid}>Not paid</span>}
        <span className={styles.sub}>{formatInstantDate(purchase.createdAt)}</span>
      </div>
    </div>
  );
}

/**
 * Dashboard — every figure computed from fetched rows via pure (…, instant) aggregates.
 *
 * ── it does NOT use useAdminData ──
 * It used to, and the monolith fetches every purchase the academy has ever taken.
 * The whole point of the month picker is that looking at October should not cost
 * you the other eleven months, so the Dashboard composes the reads it actually
 * wants and takes purchases from a windowed query instead. Everything else here is
 * small and bounded by the academy's size rather than its age, so those stay whole.
 *
 * ── two filters, and only one of them moves the money ──
 * Branch narrows every figure. The month narrows the MONEY figures only: revenue,
 * its delta, the type split, the trailing chart and the latest sales. Active
 * players, sessions this week, fill rate, today's sessions and expiring credits are
 * statements about right now — "how many players were active in March" is a
 * different question from the one this card answers, and silently repurposing the
 * card to answer it would be worse than leaving it alone. A line under the filters
 * says so whenever a past month is selected.
 */
export function Dashboard() {
  const { now } = useSession();
  const coaches = useCoaches();
  const locations = useLocations();
  const players = usePlayers();
  const packages = usePackages();
  const slots_ = useSlots();
  const batches_ = useBatches();
  const bookings_ = useBookings();
  const earliest = useEarliestPurchase();

  const [locationId, setLocationId] = useState<LocationFilter>(ALL_LOCATIONS);
  // null means "whatever month it is now", so the default survives midnight on the
  // 1st without the page holding a stale month it was mounted in.
  const [picked, setPicked] = useState<string | null>(null);
  const selectedMonth = (picked === null ? null : parseMonthKey(picked)) ?? cairoMonthOf(now);

  // The window, not the month: the delta needs the previous month and the trailing
  // chart reaches back into it too. See monthFetchRange.
  const window_ = monthFetchRange(selectedMonth);
  const purchasesQ = usePurchasesInRange(window_.start, window_.end);

  const gate = combine(coaches, locations, players, packages, slots_, batches_, bookings_, earliest, purchasesQ);
  if (gate.isPending) return <LoadingView />;
  if (gate.isError) return <ErrorView onRetry={gate.refetch} />;

  const data = {
    coaches: coaches.data ?? [],
    locations: locations.data ?? [],
    players: players.data ?? [],
    packages: packages.data ?? [],
    slots: slots_.data ?? [],
    batches: batches_.data ?? [],
    bookings: bookings_.data ?? [],
  };

  // True only between picking a month and its rows arriving. keepPreviousData means
  // the figures on screen are the PREVIOUS month's for that moment, so they are
  // dimmed rather than shown under the new month's name.
  const monthLoading = purchasesQ.isFetching;
  const months = monthChoices(earliest.data ?? null, now);
  const showingPastMonth = !isCurrentCairoMonth(selectedMonth, now);
  // An instant INSIDE the selected month drives the month aggregates; the trailing
  // chart gets its own anchor, because for the current month it must stop at today.
  const monthAnchor = monthStartInstant(selectedMonth);
  const chartAnchor = chartAnchorFor(selectedMonth, now);
  const month = monthRange(selectedMonth);

  // Filter the inputs once; every figure below is then about the same branch.
  // Active players is the exception that proves it: it was the one card reaching
  // past this block for `data.bookings`, so it counted bookings from every branch
  // against this branch's credits. It now goes through activePlayersAtLocation,
  // which filters both of its lists itself.
  // Revenue stays `succeeded AND paid` inside revenueThisMonth, so a refund-required
  // payment (068: status 'failed' + paid) can never be counted here regardless of branch.
  const windowPurchases = atLocation(purchasesQ.data ?? [], locationId);
  const slots = atLocation(data.slots, locationId);
  const batches = atLocation(data.batches, locationId);
  // The month alone, for the figures that are about the month and not the window.
  const monthPurchases = purchasesWithin(windowPurchases, month.start, month.end);

  const rev = revenueThisMonth(windowPurchases, monthAnchor);
  const rbt = revenueByType(monthPurchases, data.packages);
  const line = revenueOverTime(windowPurchases, chartAnchor).map((b) => ({ label: b.label, value: b.revenue }));
  const donutSegments: DonutSegment[] = rbt.rows.map((r) => ({
    key: r.type,
    label: TRAINING_LABEL[r.type],
    value: r.amount,
    color: DONUT_COLOR[r.type],
  }));

  const today = todaysSessions(slots, now);
  const expiring = creditsExpiringSoon(batches, now, 7);
  const recent = recentPurchases(monthPurchases, 4);

  return (
    <div>
      <PageHeader
        eyebrow="Good morning"
        title="Dashboard"
        subtitle="The state of The Padel Academy — revenue, players, sessions, and what needs your attention today."
      />

      {/* Location defaults to every branch: the Dashboard's job is "how is the
          academy doing", and the split is the follow-up question. Month defaults to
          this one, and only this one is fetched until somebody asks for another. */}
      <div className={styles.filterRow}>
        <Select
          label="Location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value as LocationFilter)}
          options={locationFilterOptions(data.locations)}
        />
        <Select
          label="Month"
          value={monthKey(selectedMonth)}
          onChange={(e) => setPicked(e.target.value)}
          options={monthOptions(months)}
        />
      </div>

      {/* Only when it can mislead. On the current month every card agrees about
          what "now" means, and the sentence would be noise. */}
      {showingPastMonth ? (
        <p className={styles.scopeNote}>
          Showing revenue for {monthLabel(selectedMonth)}. Active players, sessions, fill rate and
          expiring credits are always current.
        </p>
      ) : null}

      <div className={styles.kpis}>
        <StatCard
          className={monthLoading ? styles.loadingMonth : undefined}
          eyebrow={`Revenue · ${monthLabel(selectedMonth)}`}
          icon={DollarSign}
          iconTone="accent"
          value={formatPiastres(rev.current)}
          delta={rev.deltaPct}
          caption="vs last month"
        />
        <StatCard
          eyebrow="Active players"
          icon={Users}
          value={String(activePlayersAtLocation(data.batches, data.bookings, locationId, now))}
          caption="with credits or bookings"
        />
        <StatCard eyebrow="Sessions this week" icon={CalendarCheck} value={String(sessionsThisWeek(slots, now))} caption="booked, Sun–Wed" />
        <StatCard eyebrow="Slot fill rate" icon={Gauge} value={`${slotFillRate(slots, now)}%`} caption="capacity booked this week" />
      </div>

      <div className={[styles.charts, monthLoading ? styles.loadingMonth : ''].join(' ').trim()} aria-busy={monthLoading}>
        <Panel eyebrow={showingPastMonth ? `8 weeks to ${monthLabel(selectedMonth)}` : 'Last 8 weeks'} title="Revenue over time">
          <LineChart data={line} />
        </Panel>
        <Panel eyebrow={`What earns · ${monthLabel(selectedMonth)}`} title="Revenue by training type">
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

        <Panel
          eyebrow={showingPastMonth ? `Sales · ${monthLabel(selectedMonth)}` : 'Latest sales'}
          title="Recent purchases"
          link={{ label: 'Packages', to: '/packages' }}
        >
          {recent.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="No sales this month"
              message={`Nothing was sold in ${monthLabel(selectedMonth)}.`}
            />
          ) : (
            <div className={styles.list}>
              {recent.map((purchase) => (
                <PurchaseRow key={purchase.id} purchase={purchase} players={data.players} packages={data.packages} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
