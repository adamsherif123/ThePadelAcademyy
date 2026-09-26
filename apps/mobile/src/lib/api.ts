// The data access layer: typed reads (PostgREST) and money mutations (RPCs).
//
// Reads are scoped by RLS to the caller — `fetchCreditBatches` returns only the
// signed-in player's batches because the policy says so, not because we filter.
// Mutations are the SECURITY DEFINER RPCs; each returns `{ ok, reason }` as DATA
// (never an HTTP error), so a business rejection like `slot_full` arrives as a
// value we can map to copy, and only transport failures throw.
import {
  HISTORY_PAGE_SIZE,
  ID_PREFIXES,
  NEWS_VISIBILITY_DAYS,
  SLOT_WINDOW_TRAILING_DAYS,
  newId,
  parseInstant,
  toInstant,
  type BookBlockReason,
} from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  BookingId,
  Coach,
  CoachId,
  CreditBatch,
  CreditRequest,
  Gender,
  IsoInstant,
  Level,
  News,
  NewsId,
  NewsSeen,
  Notification,
  NotificationId,
  Package,
  PackageId,
  Piastres,
  Player,
  PlayerId,
  Purchase,
  PurchaseId,
  SessionSlot,
  SlotId,
  TrainingType,
} from '@tpa/types';

import { supabase } from './supabase';
import {
  rowToAvailabilityTemplate,
  rowToBooking,
  rowToCoach,
  rowToCreditBatch,
  rowToCreditRequest,
  rowToNews,
  rowToNewsSeen,
  rowToNotification,
  rowToPackage,
  rowToAppConfig,
  rowToPlayer,
  rowToPurchase,
  rowToSlot,
  type AppConfig,
} from './mappers';

/** A device's OS, for the push token row. */
export type Platform = 'ios' | 'android';

/** A booking/cancel RPC that reaches the server can take this long before we give up. */
export const RPC_TIMEOUT_MS = 12_000;

/** Thrown when a read/RPC fails at the transport level (offline, timeout, 5xx). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Was this failure the network, not the server? postgrest-js never throws for a
 * transport failure (no connectivity, DNS, or our own request timeout via
 * AbortSignal) — it resolves `error` with `code: ''`, because `code` is reserved
 * for a genuine PostgREST/Postgres error the server actually returned (RLS
 * rejection, constraint violation, JWT-invalid, ...), which always carries a real
 * code. This is the ONE place that distinguishes "couldn't reach the server" from
 * "the server answered no" — every caller that could otherwise misread a fetch
 * failure as an auth/business fact (SessionProvider's player/admin gate, the
 * sign-in screen's email_has_account, complete_signup) checks this instead of
 * treating any thrown ApiError as the same kind of failure.
 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && (e.cause as { code?: string } | null | undefined)?.code === '';
}

// ── reads ────────────────────────────────────────────────────────────────────
// Each throws ApiError on transport failure so React Query can retry/surface it.

async function selectAll<T>(table: string, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new ApiError(`Failed to load ${table}: ${error.message}`, error);
  return (data ?? []).map(map);
}

/**
 * `now` shifted back by `days`, as an instant — the one place every bounded fetch
 * in this file derives its lower bound from, so a window is always expressed the
 * same way (`fetchVisibleNews` predates this and reads the same shape inline).
 */
export function daysBefore(now: IsoInstant, days: number): IsoInstant {
  return toInstant(new Date(parseInstant(now).getTime() - days * 86_400_000));
}

export const fetchCoaches = (): Promise<Coach[]> => selectAll('coaches', rowToCoach);
// A signed-in (authenticated) player reads ACTIVE templates via RLS policy
// `availability_templates_select_active` (S5.1) — this is how the client knows the
// academy's operating weekdays. Anon cannot read them; these screens are behind auth.
export const fetchTemplates = (): Promise<AvailabilityTemplate[]> =>
  selectAll('availability_templates', rowToAvailabilityTemplate);
export const fetchPackages = (): Promise<Package[]> => selectAll('packages', rowToPackage);
/**
 * Published slots from `now - SLOT_WINDOW_TRAILING_DAYS` onwards — bounded below,
 * open-ended above (every future slot the academy has scheduled).
 *
 * This replaced an unbounded `select('*')`. `session_slots` is the only table RLS
 * publishes in full to every player, so that fetch was the whole slot history
 * multiplied by the entire player base, on seven screens. The trailing window is
 * what the Sessions tab's Past list renders from; anything older is fetched on
 * demand by `fetchPastSessionsPage`, so no session is unreachable.
 *
 * `session_slots(starts_at)` is indexed, so the bound is a cheap range scan.
 */
export async function fetchSlots(now: IsoInstant): Promise<SessionSlot[]> {
  const { data, error } = await supabase
    .from('session_slots')
    .select('*')
    .gte('starts_at', daysBefore(now, SLOT_WINDOW_TRAILING_DAYS));
  if (error) throw new ApiError(`Failed to load session_slots: ${error.message}`, error);
  return (data ?? []).map(rowToSlot);
}
export const fetchCreditBatches = (): Promise<CreditBatch[]> =>
  selectAll('credit_batches', rowToCreditBatch);
export const fetchBookings = (): Promise<Booking[]> => selectAll('bookings', rowToBooking);

export interface PastSessionRow {
  booking: Booking;
  slot: SessionSlot;
}

/**
 * One page of the player's OLDER past sessions — the sessions whose slot starts
 * before `before`, newest first.
 *
 * Why a cursor and not `.range(from, to)`: an offset page can shift under you when
 * a row is inserted between fetches. `before` is the start of the oldest session
 * already on screen, so each page picks up exactly where the last one stopped no
 * matter what else changed. The first call passes the trailing edge of
 * `fetchSlots`'s window, which is precisely where the pre-loaded slots run out —
 * so the free window and the paged history meet with no gap and no overlap.
 *
 * `!inner` on the embed makes `.lt('session_slots.starts_at', …)` restrict the
 * OUTER bookings rows (a plain embed would filter only the nested object), and
 * `order('session_slots(starts_at)')` sorts the bookings BY their slot's start —
 * PostgREST orders a top-level row by a to-one embedded column.
 *
 * One extra row is requested beyond the page size purely to answer "is there
 * more?" without the cost of an exact count on every tap.
 */
export async function fetchPastSessionsPage(params: {
  before: IsoInstant;
  pageSize?: number;
}): Promise<{ rows: PastSessionRow[]; hasMore: boolean }> {
  const size = params.pageSize ?? HISTORY_PAGE_SIZE;
  const { data, error } = await supabase
    .from('bookings')
    .select('*, session_slots!inner(*)')
    .lt('session_slots.starts_at', params.before)
    .order('session_slots(starts_at)', { ascending: false })
    .limit(size + 1);
  if (error) throw new ApiError(`Failed to load past sessions: ${error.message}`, error);
  const all = (data ?? []).map((r) => ({
    booking: rowToBooking(r),
    slot: rowToSlot(r.session_slots as Record<string, unknown>),
  }));
  return { rows: all.slice(0, size), hasMore: all.length > size };
}
/**
 * The player's purchases, newest first. `since` bounds them to a recent window
 * (the Purchase History screen's default); `null` is the lifetime list, which only
 * the delete-account screen needs — it values every unused credit against the
 * purchase that paid for it, so it cannot work from a window.
 */
export async function fetchPurchases(since: IsoInstant | null): Promise<Purchase[]> {
  let query = supabase.from('purchases').select('*').order('created_at', { ascending: false });
  if (since !== null) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new ApiError(`Failed to load purchases: ${error.message}`, error);
  return (data ?? []).map(rowToPurchase);
}

/**
 * How many purchases the player has ever made — a `head: true` count that fetches
 * no rows, for the Profile row's "N purchases" subtitle. The lifetime number stays
 * exact while the list behind it is windowed.
 */
export async function fetchPurchaseCount(): Promise<number> {
  const { count, error } = await supabase.from('purchases').select('id', { count: 'exact', head: true });
  if (error) throw new ApiError(`Failed to count purchases: ${error.message}`, error);
  return count ?? 0;
}

/** One purchase by id (for the return-journey poll). RLS scopes it to the caller. */
/**
 * app_config's single row (id = 1) — what the update prompt compares the installed
 * version against. `maybeSingle` so a missing row is `null` rather than a throw:
 * "no config" then behaves exactly like "offline", and the prompt simply doesn't show.
 */
export async function fetchAppConfig(): Promise<AppConfig | null> {
  const { data, error } = await supabase.from('app_config').select('*').maybeSingle();
  if (error) throw new ApiError(`Failed to load app config: ${error.message}`, error);
  return data ? rowToAppConfig(data) : null;
}

/**
 * The minimum supported version, for the hard update gate — and NOTHING else.
 *
 * Separate from fetchAppConfig for two reasons that both matter:
 *
 *  1. It must work SIGNED OUT. anon holds a COLUMN-level grant on exactly
 *     (latest_ios_version, min_supported_ios_version) (migration 058), so
 *     `select *` — which is what fetchAppConfig does — is a permission error for
 *     an anon caller. The columns are named here deliberately; widening this
 *     select would break the gate on the sign-in screen, which is the one place
 *     it most has to work.
 *  2. It returns the bare string rather than an AppConfig, because the gate must
 *     not depend on a shape whose other fields anon cannot read.
 *
 * Throws like every other reader here; the gate treats any throw as "unknown" and
 * lets the app through.
 */
export async function fetchVersionFloor(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_config')
    .select('min_supported_ios_version')
    .maybeSingle();
  if (error) throw new ApiError(`Failed to load the version floor: ${error.message}`, error);
  const value = data?.min_supported_ios_version;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function fetchPurchaseById(id: string): Promise<Purchase | null> {
  const { data, error } = await supabase.from('purchases').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(`Failed to load purchase: ${error.message}`, error);
  return data ? rowToPurchase(data) : null;
}

// ── notifications (S12.x client) ───────────────────────────────────────────────
// Reads are RLS-scoped to the caller; the only writable column is read_at. Rows are
// never inserted from the client — the event RPCs mint them via tpa.notify.

/**
 * One page of the player's notifications, newest first (RLS returns only their own).
 *
 * `notifications` is the fastest-growing table in the schema — every booking,
 * cancellation and credit request mints a row, and every news post fans out one to
 * EVERY active player — so the centre loads a page at a time instead of the whole
 * history on open. Same cursor discipline as `fetchPastSessionsPage`: `before` is
 * the timestamp of the oldest row already on screen, so pages can't shift or repeat
 * when a new notification lands mid-scroll. One extra row answers "is there more?".
 *
 * Indexed by `(player_id, created_at desc)`, so each page is a short index walk.
 */
export async function fetchNotificationsPage(params: {
  before?: IsoInstant;
  pageSize?: number;
}): Promise<{ rows: Notification[]; hasMore: boolean }> {
  const size = params.pageSize ?? HISTORY_PAGE_SIZE;
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(size + 1);
  if (params.before !== undefined) query = query.lt('created_at', params.before);
  const { data, error } = await query;
  if (error) throw new ApiError(`Failed to load notifications: ${error.message}`, error);
  const all = (data ?? []).map(rowToNotification);
  return { rows: all.slice(0, size), hasMore: all.length > size };
}

/**
 * How many notifications are unread — a `head: true` count that fetches no rows.
 * The bell badge used to derive this by pulling every notification and filtering in
 * JS; now the count is the query, so the badge is exact no matter how many pages of
 * history the centre has (or hasn't) loaded.
 */
export async function fetchUnreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw new ApiError(`Failed to count notifications: ${error.message}`, error);
  return count ?? 0;
}

/** Mark one notification read (the ONE column RLS lets the player write). Guarded so
 *  a re-mark is a no-op. */
export async function markNotificationRead(id: NotificationId, now: IsoInstant): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: now })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw new ApiError(`Failed to mark notification read: ${error.message}`, error);
}

/** Mark every unread notification read (the "mark all" the centre offers on open). */
export async function markAllNotificationsRead(now: IsoInstant): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: now })
    .is('read_at', null);
  if (error) throw new ApiError(`Failed to mark notifications read: ${error.message}`, error);
}

// ── coach mode (phase 3 reads) ─────────────────────────────────────────
// All three are scoped server-side to the CALLING coach: the slot query filters by
// their own coach id, and both RPCs resolve current_coach_id() themselves, so a
// coach can only ever pull their own schedule, their own hours and their own
// sessions' rosters (migration 050).

/**
 * How far BACK the coach's schedule reaches. The schedule answers "what am I
 * teaching", so it is forward-looking — but not from this exact second: a session
 * that started an hour ago is still today's work and should not vanish off the top
 * of the screen mid-lesson. Twelve hours keeps the whole of the current day's
 * teaching visible and nothing older. Everything after `now` is included, so a coach
 * never has to ask for more.
 */
const COACH_SCHEDULE_TRAILING_HOURS = 12;

/**
 * The coach's own sessions, soonest first — bounded below, open-ended above, the
 * same discipline every other client fetch follows. Published only, which is what
 * the RLS policy exposes anyway: a cancelled session is not work.
 */
export async function fetchCoachSlots(coachId: CoachId, now: IsoInstant): Promise<SessionSlot[]> {
  const cutoff = toInstant(new Date(parseInstant(now).getTime() - COACH_SCHEDULE_TRAILING_HOURS * 3_600_000));
  const { data, error } = await supabase
    .from('session_slots')
    .select('*')
    .eq('coach_id', coachId)
    .eq('status', 'published')
    .gte('starts_at', cutoff)
    .order('starts_at', { ascending: true });
  if (error) throw new ApiError(`Failed to load your schedule: ${error.message}`, error);
  return (data ?? []).map(rowToSlot);
}

/**
 * Hours coached in a Cairo calendar month — the caller's OWN row only (the RPC is
 * scoped by current_coach_id()). `month` is any date inside the wanted month;
 * omitted means the current one. Zero when nothing has been counted yet — an absent
 * row and a genuine zero are the same answer to "what have I earned".
 */
export async function fetchMyCoachHours(month?: Date): Promise<number> {
  const { data, error } = await supabase.rpc(
    'coach_hours_coached',
    month ? { p_month: month.toISOString().slice(0, 10) } : {},
  );
  if (error) throw new ApiError(`Failed to load your hours: ${error.message}`, error);
  const rows = (data ?? []) as { coach_id: string; hours: number }[];
  return rows.length > 0 ? Number(rows[0]?.hours ?? 0) : 0;
}

/** The coach Dashboard's numbers, all from one RPC (migration 052). */
export interface CoachDashboard {
  sessionsThisMonth: number;
  sessionsThisWeek: number;
  upcomingCount: number;
  studentsThisMonth: number;
  /** Whole percent, 0-100. Average occupancy per session this month. */
  fillRate: number;
  breakdown: { group: number; duo: number; individual: number };
  hoursThisMonth: number;
  hoursLastMonth: number;
  /** Oldest first, four buckets, each starting on a Cairo Sunday. */
  weeklyHours: { weekStart: string; hours: number }[];
}

/**
 * The whole Dashboard in ONE call. The numbers span every session the coach has
 * taught this month and the rosters on them, so they are aggregated server-side —
 * the alternative was every session plus a roster call each, which is the
 * over-fetching the bounded-fetch work removed everywhere else.
 *
 * Returns null for an account with no coach link (the RPC's own answer), which the
 * screen renders as "not linked" rather than a page of zeros.
 */
export async function fetchCoachDashboard(): Promise<CoachDashboard | null> {
  const { data, error } = await supabase.rpc('coach_dashboard_summary');
  if (error) throw new ApiError(`Failed to load your dashboard: ${error.message}`, error);
  if (data == null) return null;
  const d = data as Record<string, unknown>;
  const b = (d.breakdown ?? {}) as Record<string, unknown>;
  return {
    sessionsThisMonth: Number(d.sessions_this_month ?? 0),
    sessionsThisWeek: Number(d.sessions_this_week ?? 0),
    upcomingCount: Number(d.upcoming_count ?? 0),
    studentsThisMonth: Number(d.students_this_month ?? 0),
    fillRate: Number(d.fill_rate ?? 0),
    breakdown: {
      group: Number(b.group ?? 0),
      duo: Number(b.duo ?? 0),
      individual: Number(b.individual ?? 0),
    },
    hoursThisMonth: Number(d.hours_this_month ?? 0),
    hoursLastMonth: Number(d.hours_last_month ?? 0),
    weeklyHours: ((d.weekly_hours ?? []) as Record<string, unknown>[]).map((w) => ({
      weekStart: String(w.week_start),
      hours: Number(w.hours ?? 0),
    })),
  };
}

/** One booked player on a coach's own session. Name and level are ALL the RPC
 *  returns — no contact details reach the coach app (migration 050). */
export interface RosterEntry {
  name: string;
  level: Level;
}

/**
 * Who is booked on one of the caller's own sessions, cancelled bookings excluded.
 * Another coach's slot returns an empty list rather than an error, so the screen
 * renders "nobody yet" instead of a failure it cannot explain.
 */
export async function fetchCoachRoster(slotId: SlotId): Promise<RosterEntry[]> {
  const { data, error } = await supabase.rpc('coach_session_roster', { p_slot_id: slotId });
  if (error) throw new ApiError(`Failed to load the roster: ${error.message}`, error);
  return ((data ?? []) as { name: string; level: string }[]).map((r) => ({
    name: r.name,
    level: r.level as Level,
  }));
}

// ── news (client session) ────────────────────────────────────────────────────
// RLS lets any authenticated player read every news row — the visibility window
// is a query-side filter here, not a server-side rule (see NEWS_VISIBILITY_DAYS).
// news_seen is the player's own-row-only "have I seen this" set: a row's mere
// existence means seen, so marking seen is an insert, never an update.

/** Visible news (within the window), newest first. */
export async function fetchVisibleNews(now: IsoInstant): Promise<News[]> {
  const cutoff = toInstant(new Date(parseInstant(now).getTime() - NEWS_VISIBILITY_DAYS * 86_400_000));
  const { data, error } = await supabase
    .from('news')
    .select('*')
    .gt('created_at', cutoff)
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(`Failed to load news: ${error.message}`, error);
  return (data ?? []).map(rowToNews);
}

/** This player's own seen-rows (RLS scopes it — every row belongs to the caller). */
export async function fetchNewsSeen(): Promise<NewsSeen[]> {
  const { data, error } = await supabase.from('news_seen').select('*');
  if (error) throw new ApiError(`Failed to load seen news: ${error.message}`, error);
  return (data ?? []).map(rowToNewsSeen);
}

/**
 * Mark one or more news items seen for `playerId` (always the caller's own id —
 * RLS's `player_id = current_player_id()` rejects anything else). `ignoreDuplicates`
 * makes this safe to call repeatedly for the same item (the pop-up's dismiss and
 * the feed's "mark everything visible seen" can race harmlessly) — a duplicate
 * (player_id, news_id) pair is a no-op, not an error.
 */
export async function markNewsSeen(playerId: PlayerId, newsIds: NewsId[]): Promise<void> {
  if (newsIds.length === 0) return;
  const { error } = await supabase
    .from('news_seen')
    .upsert(
      newsIds.map((newsId) => ({ player_id: playerId, news_id: newsId })),
      { onConflict: 'player_id,news_id', ignoreDuplicates: true },
    );
  if (error) throw new ApiError(`Failed to mark news seen: ${error.message}`, error);
}

/** The public URL for a news item's image — image_path is a raw storage key, not a URL. */
export function newsImagePublicUrl(path: string): string {
  return supabase.storage.from('news-images').getPublicUrl(path).data.publicUrl;
}

// ── device push tokens (own-only RLS path — never service_role in the app) ──────

/**
 * Register/refresh THIS device's Expo token for the signed-in player via the
 * register_push_token RPC (S12.1). The RPC resolves the caller server-side (never a
 * player_id argument) and reassigns-or-inserts as definer — the only way to claim a
 * token last registered to a DIFFERENT player on this shared device, since own-only
 * reads hide that row from a direct client write. Not service_role: an ordinary RPC.
 */
export async function registerMyPushToken(token: string, platform: Platform): Promise<void> {
  const { data, error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw new ApiError(`Push token register failed: ${error.message}`, error);
  const d = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!d.ok) throw new ApiError(`Push token register rejected: ${d.reason ?? 'unknown'}`);
}

/** Drop THIS device's token (sign-out / account deletion). Only removes the row if it
 *  is the caller's (RLS delete-own), so signing out on phone A never mutes phone B. */
export async function deleteMyPushToken(token: string): Promise<void> {
  const { error } = await supabase.from('device_push_tokens').delete().eq('expo_push_token', token);
  if (error) throw new ApiError(`Push token delete failed: ${error.message}`, error);
}

// ── payments (S6 / Paymob) ─────────────────────────────────────────────────────
// The client inserts ONLY a PENDING purchase; RLS enforces player ownership AND
// amount = the active package price (S5.1 test 23). The webhook (service_role, after
// HMAC) is the only thing that ever settles it. We never self-confirm.
export async function insertPendingPurchase(
  playerId: PlayerId,
  packageId: PackageId,
  amount: Piastres,
  now: IsoInstant,
): Promise<PurchaseId> {
  const id = newId(ID_PREFIXES.purchase) as PurchaseId;
  const { error } = await supabase.from('purchases').insert({
    id,
    player_id: playerId,
    package_id: packageId,
    status: 'pending',
    payment_method: 'paymob', // NOT NULL + RLS both require this; cash sales are admin-only (S5.2)
    amount, // must equal the active package price or RLS rejects the insert
    created_at: now,
    gateway_order_id: null,
    gateway_transaction_id: null,
  });
  if (error) throw new ApiError(`Could not start the purchase: ${error.message}`, error);
  return id;
}

/**
 * Ask the create-checkout Edge Function for a Paymob checkout URL. functions.invoke
 * swallows the error BODY on a non-2xx (you get only "non-2xx status code"), so we
 * read error.context (the Response) and surface the real reason — the briefing's
 * 3-round lesson.
 */
export async function createCheckout(purchaseId: PurchaseId): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: { purchaseId },
  });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === 'function') {
      detail = await ctx.text().catch(() => error.message);
    }
    throw new ApiError(`Checkout failed: ${detail}`, error);
  }
  const url = (data as { checkoutUrl?: string })?.checkoutUrl;
  if (!url) throw new ApiError('Checkout failed: no URL returned.');
  return url;
}

/**
 * Delete the signed-in player's account (Apple 5.1.1(v)). The Edge Function verifies
 * the caller's JWT, runs the caller-scoped delete_account RPC (anonymise + detach),
 * then deletes the auth identity via the Admin API. We read error.context for the
 * real reason on a non-2xx, like createCheckout. Resolves on success; throws otherwise.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === 'function') {
      detail = await ctx.text().catch(() => error.message);
    }
    throw new ApiError(`Could not delete your account: ${detail}`, error);
  }
}

/** The signed-in player's own row (RLS returns exactly zero or one). null = no profile yet. */
export async function fetchCurrentPlayer(): Promise<Player | null> {
  const { data, error } = await supabase.from('players').select('*').maybeSingle();
  if (error) throw new ApiError(`Failed to load player: ${error.message}`, error);
  return data ? rowToPlayer(data) : null;
}

/**
 * Is the signed-in auth user an ADMIN? (A1: admins are a separate identity with NO player
 * row.) The consumer app uses this to REFUSE an admin credential — an admin who signs in
 * here has no player and must never be sent to profile-setup (bug #2). is_admin() reads the
 * admins table under the caller's JWT; false for every player.
 */
export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) throw new ApiError(`is_admin failed: ${error.message}`, error);
  return Boolean(data);
}

// ── RPC result contracts (mirror the jsonb the functions return) ──────────────

/**
 * type_required / invalid_type are RPC-only defensive reasons — unreachable
 * from a correct client (the picker only ever offers types bookableTypesFor
 * says are affordable, and the confirm screen always resolves a concrete
 * chosenType before calling book_slot). Modelled here so the exhaustive
 * switch in confirm-booking.tsx must still account for them: if the RPC ever
 * actually returns one, that's a real bug to report to Sentry, not silently
 * swallow — see Task 4.
 */
export type BookReason =
  | BookBlockReason
  | 'slot_missing'
  | 'already_booked'
  | 'not_authenticated'
  | 'type_required'
  | 'invalid_type';

export type BookRpcResult =
  | { ok: true; bookingId: BookingId; creditBatchId: string }
  | { ok: false; reason: BookReason };

export type CancelReason =
  | 'booking_missing'
  | 'not_owner'
  | 'already_cancelled'
  | 'not_cancellable'
  | 'slot_missing'
  | 'not_authenticated';

export type CancelRpcResult =
  | { ok: true; refunded: boolean; creditBatchId: string | null }
  | { ok: false; reason: CancelReason };

export type SignupReason =
  | 'name_required'
  | 'invalid_gender'
  | 'invalid_level'
  | 'not_authenticated'
  | 'is_admin' // A1/A2: an admin identity can never become a player (defence in depth)
  | 'phone_required' // phone is required at signup (not required later — see update_profile)
  | 'phone_taken' // the phone is UNIQUE — another player already has it
  | 'invalid_phone'; // the phone isn't a valid EG mobile

export type SignupRpcResult =
  | { ok: true; alreadyCompleted: boolean; playerId: string }
  | { ok: false; reason: SignupReason };

// ── credit requests (A3/A4) — report an out-of-band payment for admin approval ──

/** The signed-in player's own credit requests, newest first (RLS scopes to caller). */
export async function fetchMyCreditRequests(): Promise<CreditRequest[]> {
  const { data, error } = await supabase
    .from('credit_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(`Failed to load credit requests: ${error.message}`, error);
  return (data ?? []).map(rowToCreditRequest);
}

/**
 * Upload a payment-proof screenshot to the PRIVATE payment-proofs bucket, under the
 * player's OWN folder (the A3 path convention `<player_id>/…`, enforced by the Storage
 * RLS). Returns the storage key to hand to request_credits. Throws ApiError on failure —
 * the caller treats proof as OPTIONAL and submits the request without it if this throws.
 */
export async function uploadProof(playerId: PlayerId, uri: string, mimeType?: string): Promise<string> {
  const mt = mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/jpeg';
  const ext = mt === 'image/png' ? 'png' : mt === 'image/webp' ? 'webp' : 'jpg';
  const path = `${playerId}/proof-${Date.now()}.${ext}`;
  // React Native: read the picked file's bytes. fetch(file-uri).arrayBuffer() works with the
  // url-polyfill already imported for the Supabase client.
  const bytes = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(path, bytes, { contentType: mt, upsert: true });
  if (error) throw new ApiError(`Proof upload failed: ${error.message}`, error);
  return path;
}

export type RequestCreditsReason =
  | 'not_authenticated'
  | 'invalid_payment_method'
  | 'already_pending'
  | 'package_missing'
  | 'trial_already_used' // A5: the once-per-player trial has already been used
  | 'package_inactive'
  | 'invalid_proof_path';

/** Can the signed-in player still buy the once-per-player trial? (A5 — hides trial in the store.) */
export async function trialEligibleRpc(): Promise<boolean> {
  const { data, error } = await supabase.rpc('trial_eligible');
  if (error) throw new ApiError(`trial_eligible failed: ${error.message}`, error);
  return Boolean(data);
}

export type RequestCreditsResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: RequestCreditsReason };

/** Submit a credit request (a reported InstaPay/cash payment). Mints nothing — the admin
 *  approves. proofPath is optional (a cash request may have none). {ok,reason} as data. */
export async function requestCreditsRpc(
  packageId: PackageId,
  method: 'instapay' | 'cash',
  proofPath: string | null,
): Promise<RequestCreditsResult> {
  const d = (await callRpc('request_credits', {
    p_package_id: packageId,
    p_payment_method: method,
    p_proof_path: proofPath,
  })) as Record<string, unknown>;
  if (d.ok) return { ok: true, requestId: d.request_id as string };
  return { ok: false, reason: d.reason as RequestCreditsReason };
}

/** Run an RPC with an abort timeout so a stalled request can't spin forever. */
async function callRpc(fn: string, argsPayload: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase
    .rpc(fn, argsPayload)
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) throw new ApiError(`${fn} failed: ${error.message}`, error);
  return data;
}

/**
 * `trainingType` is the player's pick from the type picker on an OPEN block;
 * null for an already-typed slot (the RPC's own default — book_slot resolves
 * the type from the slot itself when it's already set, same as before the
 * booking rework).
 */
export async function bookSlotRpc(slotId: SlotId, trainingType: TrainingType | null): Promise<BookRpcResult> {
  const d = (await callRpc('book_slot', { p_slot_id: slotId, p_training_type: trainingType })) as Record<
    string,
    unknown
  >;
  if (d.ok) {
    return { ok: true, bookingId: d.booking_id as BookingId, creditBatchId: d.credit_batch_id as string };
  }
  return { ok: false, reason: d.reason as BookReason };
}

export async function cancelBookingRpc(bookingId: BookingId): Promise<CancelRpcResult> {
  const d = (await callRpc('cancel_booking', { p_booking_id: bookingId })) as Record<string, unknown>;
  if (d.ok) {
    return { ok: true, refunded: Boolean(d.refunded), creditBatchId: (d.credit_batch_id as string) ?? null };
  }
  return { ok: false, reason: d.reason as CancelReason };
}

// ── edit profile (update_profile RPC) ──────────────────────────────────────────
// The post-signup counterpart to complete_signup: updates an EXISTING player's
// name/gender/level and adds/replaces/clears the optional phone, reusing the same
// server-side E.164 + phone_taken validation. `no_player` is the caller-isn't-a-player
// case (admin / retired row) — unreachable from the profile screen, modelled for the
// exhaustive switch. {ok, reason} as data; only transport failures throw.
export type UpdateProfileReason =
  | 'name_required'
  | 'invalid_gender'
  | 'invalid_level'
  | 'not_authenticated'
  | 'no_player'
  | 'is_admin'
  | 'phone_taken'
  | 'invalid_phone';

export type UpdateProfileResult =
  | { ok: true; playerId: string }
  | { ok: false; reason: UpdateProfileReason };

export async function updateProfileRpc(draft: {
  name: string;
  gender: Gender;
  level: Level;
  phone?: string | null;
}): Promise<UpdateProfileResult> {
  const d = (await callRpc('update_profile', {
    p_name: draft.name,
    p_gender: draft.gender,
    p_level: draft.level,
    // Same optional-phone contract as complete_signup: blank → null (clears it); the
    // server normalises to +20 E.164 and rejects a duplicate/invalid number.
    p_phone: draft.phone?.trim() ? draft.phone.trim() : null,
  })) as Record<string, unknown>;
  if (d.ok) return { ok: true, playerId: d.player_id as string };
  return { ok: false, reason: d.reason as UpdateProfileReason };
}

export async function completeSignupRpc(draft: {
  name: string;
  gender: Gender;
  level: Level;
  phone?: string | null;
  trainedBefore?: boolean | null;
}): Promise<SignupRpcResult> {
  const d = (await callRpc('complete_signup', {
    p_name: draft.name,
    p_gender: draft.gender,
    p_level: draft.level,
    // Optional. The server normalises to +20 E.164 and rejects a duplicate/invalid number.
    p_phone: draft.phone?.trim() ? draft.phone.trim() : null,
    // A5: self-reported new-vs-returning (trusted). null if unanswered.
    p_trained_before: draft.trainedBefore ?? null,
  })) as Record<string, unknown>;
  if (d.ok) {
    return { ok: true, alreadyCompleted: Boolean(d.already_completed), playerId: d.player_id as string };
  }
  return { ok: false, reason: d.reason as SignupReason };
}

/**
 * Does a player account exist for this email? (A2.1 sign-in routing.) The RPC returns one
 * bit and nothing else — no name, id, or admin-ness — and is callable unauthenticated (the
 * caller is on the sign-in screen). false for an admin email (they have no player row), so
 * the consumer flow routes them to create-account → where signUp/complete_signup refuse
 * them (A1) and they hit the not-a-player screen. Throws only on transport failure.
 */
export async function emailHasAccount(email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('email_has_account', { p_email: email.trim() });
  if (error) throw new ApiError(`email_has_account failed: ${error.message}`, error);
  return Boolean(data);
}
