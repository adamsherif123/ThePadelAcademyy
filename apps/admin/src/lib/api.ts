// The admin data access layer: RLS-scoped reads, the money/occupancy RPCs, the
// is_admin()-gated direct config writes, and the coach-photo upload.
//
// Reads return everything an admin is entitled to (all players/batches/purchases,
// cancelled slots, inactive coaches/packages/templates) — that's what is_admin()
// unlocks in the SELECT policies, not a client-side filter. RPCs return {ok, reason}
// as DATA; only transport failures throw (an ApiError the mutation layer catches).
// Direct writes throw ApiError on failure too, carrying the Postgres SQLSTATE so the
// mutation layer can map 23P01 (coach double-booking) to real copy.
import { ID_PREFIXES, newId } from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  BookingStatus,
  Coach,
  CoachId,
  CreditBatch,
  CreditRequest,
  Gender,
  Level,
  News,
  NewsId,
  Package,
  PackageId,
  Player,
  PlayerId,
  Purchase,
  SessionSlot,
  SlotId,
  TrainingType,
  Weekday,
} from '@tpa/types';

import type { BookingRow, BookingStatusCounts } from '../data/bookingList';
import { supabase } from './supabase';
import {
  rowToAvailabilityTemplate,
  rowToBooking,
  rowToCoach,
  rowToCreditBatch,
  rowToCreditRequest,
  rowToNews,
  rowToPackage,
  rowToPlayer,
  rowToPurchase,
  rowToSlot,
} from './mappers';

export class ApiError extends Error {
  /** The Postgres SQLSTATE, when the failure came from the DB (e.g. '23P01'). */
  readonly code?: string;
  readonly reason?: unknown;
  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.reason = cause;
  }
}

// ── reads ─────────────────────────────────────────────────────────────────────
async function selectAll<T>(table: string, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new ApiError(`Failed to load ${table}: ${error.message}`, error.code, error);
  return (data ?? []).map(map);
}

export const fetchCoaches = (): Promise<Coach[]> => selectAll('coaches', rowToCoach);

/**
 * Hours coached per coach THIS CALENDAR MONTH (Africa/Cairo) — a SQL-side
 * aggregate (coach_hours_coached), not a client sum over fetched slots/bookings.
 * Returns one row per coach with at least one qualifying (finished this month,
 * not-cancelled, ≥1 attended booking) slot; a coach with none is simply absent —
 * the caller defaults to 0, same as a coach with zero rows would read either way.
 *
 * The RPC takes an optional p_month for any past month (payroll); we send none,
 * which is the current month. Rolling to a new month is a moving WHERE clause,
 * not a reset — every past month stays computable from the same untouched rows.
 */
export async function fetchCoachHours(): Promise<Record<CoachId, number>> {
  const { data, error } = await supabase.rpc('coach_hours_coached');
  if (error) throw new ApiError(`Failed to load coach hours: ${error.message}`, error.code, error);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { coach_id: string; hours: number }[]) {
    out[row.coach_id] = Number(row.hours);
  }
  return out as Record<CoachId, number>;
}
export const fetchPlayers = (): Promise<Player[]> => selectAll('players', rowToPlayer);
export const fetchPackages = (): Promise<Package[]> => selectAll('packages', rowToPackage);
export const fetchTemplates = (): Promise<AvailabilityTemplate[]> =>
  selectAll('availability_templates', rowToAvailabilityTemplate);
export const fetchSlots = (): Promise<SessionSlot[]> => selectAll('session_slots', rowToSlot);
export const fetchCreditBatches = (): Promise<CreditBatch[]> => selectAll('credit_batches', rowToCreditBatch);
export const fetchBookings = (): Promise<Booking[]> => selectAll('bookings', rowToBooking);
export const fetchPurchases = (): Promise<Purchase[]> => selectAll('purchases', rowToPurchase);
export const fetchCreditRequests = (): Promise<CreditRequest[]> => selectAll('credit_requests', rowToCreditRequest);

/**
 * Every news row, newest first — RLS lets any authenticated user (admin
 * sessions included) SELECT all of them directly, no RPC needed. Unlike
 * selectAll's tables this one has an intrinsic order (publish time), so it's
 * its own small query rather than a selectAll() call.
 */
export async function fetchNews(): Promise<News[]> {
  const { data, error } = await supabase.from('news').select('*').order('created_at', { ascending: false });
  if (error) throw new ApiError(`Failed to load news: ${error.message}`, error.code, error);
  return (data ?? []).map(rowToNews);
}

export type CreateNewsReason = 'not_admin' | 'title_required' | 'body_required';
export type CreateNewsResult = { ok: true; newsId: NewsId } | { ok: false; reason: CreateNewsReason };
/** Creates a news item; if notifyPlayers, fans out one news_published push to every active player. */
export async function createNewsRpc(
  title: string,
  body: string,
  imagePath: string | null,
  notifyPlayers: boolean,
): Promise<CreateNewsResult> {
  const d = await callRpc('create_news', { p_title: title, p_body: body, p_image_path: imagePath, p_notify_players: notifyPlayers });
  return d.ok ? { ok: true, newsId: d.news_id as NewsId } : { ok: false, reason: d.reason as CreateNewsReason };
}

export type UpdateNewsReason = 'not_admin' | 'title_required' | 'body_required' | 'news_missing';
export type UpdateNewsResult = { ok: true } | { ok: false; reason: UpdateNewsReason };
/** Edits title/body/image — never re-notifies (only create does). imagePath must always be
 *  passed explicitly (the current path if unchanged, a new one, or null to clear). */
export async function updateNewsRpc(
  id: NewsId,
  title: string,
  body: string,
  imagePath: string | null,
): Promise<UpdateNewsResult> {
  const d = await callRpc('update_news', { p_news_id: id, p_title: title, p_body: body, p_image_path: imagePath });
  return d.ok ? { ok: true } : { ok: false, reason: d.reason as UpdateNewsReason };
}

export type DeleteNewsReason = 'not_admin' | 'news_missing';
export type DeleteNewsResult = { ok: true } | { ok: false; reason: DeleteNewsReason };
/** Hard-deletes a news item — cascades its news_seen rows, sets notifications.news_id null. */
export async function deleteNewsRpc(id: NewsId): Promise<DeleteNewsResult> {
  const d = await callRpc('delete_news', { p_news_id: id });
  return d.ok ? { ok: true } : { ok: false, reason: d.reason as DeleteNewsReason };
}

export type BookingStatusFilter = BookingStatus | 'all';
export type BookingTypeFilter = TrainingType | 'all';

export interface BookingsPageParams {
  page: number; // 0-indexed
  pageSize: number;
  search: string; // trimmed; '' = no filter
  status: BookingStatusFilter;
  type: BookingTypeFilter;
}

export interface BookingsPageResult {
  rows: BookingRow[];
  total: number;
}

// `!inner` on both embeds: player_id/slot_id are NOT NULL FKs so this never drops a
// legitimate row, but it's what makes .eq('session_slots.training_type', …) and
// .ilike('players.name', …) below actually restrict the OUTER bookings rows —
// PostgREST embeds are left joins by default, which would only filter the nested
// object and leave every booking row in the result.
const BOOKINGS_PAGE_SELECT = '*, players!inner(*), session_slots!inner(*, coaches(*))';

function rowToBookingPageRow(r: Record<string, unknown>): BookingRow {
  const playerRow = r.players as Record<string, unknown> | null;
  const slotRow = r.session_slots as Record<string, unknown> | null;
  const coachRow = slotRow ? (slotRow.coaches as Record<string, unknown> | null) : null;
  return {
    booking: rowToBooking(r),
    player: playerRow ? rowToPlayer(playerRow) : undefined,
    slot: slotRow ? rowToSlot(slotRow) : undefined,
    coach: coachRow ? rowToCoach(coachRow) : undefined,
  };
}

/**
 * The Bookings page's own bounded query — newest `booked_at` first, `pageSize`
 * rows at a time, each row's player/slot/coach embedded in the same round trip
 * (never the whole-table monolith). Search/status/type filter server-side, so a
 * filter change is a different WHERE clause + a fresh count, never a client-side
 * scan of whatever page happened to be loaded.
 */
export async function fetchBookingsPage(params: BookingsPageParams): Promise<BookingsPageResult> {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = supabase
    .from('bookings')
    .select(BOOKINGS_PAGE_SELECT, { count: 'exact' })
    .order('booked_at', { ascending: false })
    .range(from, to);
  if (params.status !== 'all') query = query.eq('status', params.status);
  if (params.type !== 'all') query = query.eq('session_slots.training_type', params.type);
  const search = params.search.trim();
  if (search !== '') query = query.ilike('players.name', `%${search}%`);
  const { data, error, count } = await query;
  if (error) throw new ApiError(`Failed to load bookings: ${error.message}`, error.code, error);
  return { rows: (data ?? []).map(rowToBookingPageRow), total: count ?? 0 };
}

// ── credit-requests page (bounded, mirrors the bookings/players pages) ───────

export type CreditRequestStatusFilter = CreditRequest['status'] | 'all';

export interface CreditRequestsPageParams {
  page: number; // 0-indexed
  pageSize: number;
  status: CreditRequestStatusFilter;
}

export interface CreditRequestRow {
  request: CreditRequest;
  player: Player | undefined;
  pkg: Package | undefined;
  /** The purchase an APPROVAL created; undefined while pending or declined. */
  purchase: Purchase | undefined;
}

export interface CreditRequestsPageResult {
  rows: CreditRequestRow[];
  total: number;
}

export interface CreditRequestStatusCounts {
  pending: number;
  approved: number;
  rejected: number;
}

// PLAIN embeds, not `!inner`. Both FKs are NOT NULL so an inner join wouldn't drop a
// legitimate row today — but nothing here filters on the embedded tables (the only
// filter is credit_requests.status), so `!inner` would buy nothing and would silently
// drop a row if a package ever went missing. The row already renders '—' for an absent
// package; a plain embed keeps that tolerance instead of hiding the request entirely.
// `purchases(*)` rides along via credit_requests.purchase_id so an approved row can
// show whether its money has been collected. That FK is NULL while a request is
// pending or declined, which is the other reason these must stay PLAIN embeds.
const CREDIT_REQUESTS_PAGE_SELECT = '*, players(*), packages(*), purchases(*)';

function rowToCreditRequestPageRow(r: Record<string, unknown>): CreditRequestRow {
  const playerRow = r.players as Record<string, unknown> | null;
  const pkgRow = r.packages as Record<string, unknown> | null;
  const purchaseRow = r.purchases as Record<string, unknown> | null;
  return {
    request: rowToCreditRequest(r),
    player: playerRow ? rowToPlayer(playerRow) : undefined,
    pkg: pkgRow ? rowToPackage(pkgRow) : undefined,
    purchase: purchaseRow ? rowToPurchase(purchaseRow) : undefined,
  };
}

/**
 * The Credit Requests page's own bounded query — newest `created_at` first, `pageSize`
 * rows at a time, each row's player and package embedded in the same round trip
 * (never the whole-table monolith).
 *
 * The status filter runs SERVER-side, which is the whole point: this is an approval
 * queue, and an admin filtering to "pending" must see every pending request across all
 * pages, not the pending ones that happen to fall inside the current ten.
 */
export async function fetchCreditRequestsPage(
  params: CreditRequestsPageParams,
): Promise<CreditRequestsPageResult> {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = supabase
    .from('credit_requests')
    .select(CREDIT_REQUESTS_PAGE_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (params.status !== 'all') query = query.eq('status', params.status);
  const { data, error, count } = await query;
  if (error) throw new ApiError(`Failed to load credit requests: ${error.message}`, error.code, error);
  return { rows: (data ?? []).map(rowToCreditRequestPageRow), total: count ?? 0 };
}

const CREDIT_REQUEST_STATUSES: CreditRequest['status'][] = ['pending', 'approved', 'rejected'];

/**
 * The three status counts — over the WHOLE table, independent of the current page and
 * of the active filter, so "N awaiting review" stays true no matter what you're
 * looking at. Three head:true counts (no rows fetched), the same shape
 * fetchBookingStatusCounts uses.
 */
export async function fetchCreditRequestStatusCounts(): Promise<CreditRequestStatusCounts> {
  const results = await Promise.all(
    CREDIT_REQUEST_STATUSES.map((s) =>
      supabase.from('credit_requests').select('id', { count: 'exact', head: true }).eq('status', s),
    ),
  );
  const counts: CreditRequestStatusCounts = { pending: 0, approved: 0, rejected: 0 };
  results.forEach((r, i) => {
    if (r.error) throw new ApiError(`Failed to load credit-request counts: ${r.error.message}`, r.error.code, r.error);
    counts[CREDIT_REQUEST_STATUSES[i]!] = r.count ?? 0;
  });
  return counts;
}

// ── players page (bounded, mirrors the bookings page above) ───────────────────

export type PlayerGenderFilter = Gender | 'all';
export type PlayerLevelFilter = Level | 'all';

export interface PlayersPageParams {
  page: number; // 0-indexed
  pageSize: number;
  search: string; // trimmed; '' = no filter
  gender: PlayerGenderFilter;
  level: PlayerLevelFilter;
}

export interface PlayerRow {
  player: Player;
  /** This player's OWN credit batches, embedded in the same round trip. */
  batches: CreditBatch[];
}

export interface PlayersPageResult {
  rows: PlayerRow[];
  total: number;
}

// The row shows a G/D/I credit breakdown, so each player's batches ride along in the
// same request. A plain embed (not `!inner`): a player with no credits yet must still
// appear in the roster, which an inner join would silently drop.
const PLAYERS_PAGE_SELECT = '*, credit_batches(*)';

function rowToPlayerPageRow(r: Record<string, unknown>): PlayerRow {
  const batchRows = (r.credit_batches as Record<string, unknown>[] | null) ?? [];
  return { player: rowToPlayer(r), batches: batchRows.map(rowToCreditBatch) };
}

/**
 * The Players page's own bounded query — newest `created_at` first, `pageSize` rows at
 * a time, each row's credit batches embedded (never the whole-table monolith).
 *
 * Search and the gender/level filters run server-side, so they reach the WHOLE roster
 * and the count reflects the filtered set — a client-side filter over a 10-row page
 * would only ever search the page you happen to be looking at, which is worse than no
 * search at all.
 *
 * `deleted_at is null` preserves the roster's existing meaning: a deleted account is
 * anonymised and retained (its history keeps resolving elsewhere) but never listed as
 * someone the admin can select or act on — what `activePlayers` did client-side.
 */
export async function fetchPlayersPage(params: PlayersPageParams): Promise<PlayersPageResult> {
  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = supabase
    .from('players')
    .select(PLAYERS_PAGE_SELECT, { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (params.gender !== 'all') query = query.eq('gender', params.gender);
  if (params.level !== 'all') query = query.eq('level', params.level);
  const search = params.search.trim();
  if (search !== '') {
    // PostgREST's `or=` grammar is comma-separated with parens, so a comma, paren,
    // quote or backslash in the term would break the filter string itself. None of them
    // are meaningful in a name/phone/email search, so they're dropped rather than escaped.
    const safe = search.replace(/[,()"\\]/g, '');
    // Stored phones are E.164 with no spaces (signup normalises them), so the space
    // stripping matchesPlayerQuery does client-side is applied to the TERM here.
    const phoneTerm = safe.replace(/\s+/g, '');
    query = query.or(
      `name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${phoneTerm}%`,
    );
  }
  const { data, error, count } = await query;
  if (error) throw new ApiError(`Failed to load players: ${error.message}`, error.code, error);
  return { rows: (data ?? []).map(rowToPlayerPageRow), total: count ?? 0 };
}

const BOOKING_STATUSES: BookingStatus[] = ['booked', 'attended', 'cancelled', 'no_show'];

/**
 * The 4 status-count cards — independent of the current page or filters, so they
 * stay accurate across every booking, not just the page in view. 4 head:true
 * counts (no rows fetched) rather than a full select('*') aggregated client-side.
 */
export async function fetchBookingStatusCounts(): Promise<BookingStatusCounts> {
  const results = await Promise.all(
    BOOKING_STATUSES.map((s) => supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('status', s)),
  );
  const counts = { booked: 0, attended: 0, cancelled: 0, no_show: 0 } as BookingStatusCounts;
  results.forEach((r, i) => {
    if (r.error) throw new ApiError(`Failed to load booking counts: ${r.error.message}`, r.error.code, r.error);
    counts[BOOKING_STATUSES[i]!] = r.count ?? 0;
  });
  return counts;
}

/**
 * A short-lived signed URL to display a payment-proof screenshot from the PRIVATE
 * payment-proofs bucket (the admin has read-all via RLS, but the bucket isn't public so a
 * plain URL 404s — A3 flagged this). 300s (5 min) is plenty to review one request and short
 * enough that a copied link doesn't linger; the queue re-signs on demand.
 */
export async function proofSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 300);
  if (error || !data) throw new ApiError(`Could not load the proof: ${error?.message ?? 'unknown'}`, undefined, error);
  return data.signedUrl;
}

/** The signed-in admin's own player row (RLS: exactly zero or one). Drives the auth gate. */
export async function fetchCurrentPlayer(): Promise<Player | null> {
  const { data, error } = await supabase.from('players').select('*').maybeSingle();
  if (error) throw new ApiError(`Failed to load player: ${error.message}`, error.code, error);
  return data ? rowToPlayer(data) : null;
}

/** Is the signed-in user an admin? Reads the is_admin() RPC. */
export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) throw new ApiError(`is_admin failed: ${error.message}`, error.code, error);
  return Boolean(data);
}

// ── RPC result contracts (mirror the jsonb the functions return) ───────────────
async function callRpc(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(`${fn} failed: ${error.message}`, error.code, error);
  return (data ?? {}) as Record<string, unknown>;
}

export type CancelSessionReason = 'not_admin' | 'slot_missing' | 'already_cancelled';
export type CancelSessionResult =
  | { ok: true; refundedCount: number }
  | { ok: false; reason: CancelSessionReason };
export async function cancelSessionRpc(slotId: SlotId): Promise<CancelSessionResult> {
  const d = await callRpc('cancel_session', { p_slot_id: slotId });
  return d.ok
    ? { ok: true, refundedCount: Number(d.refunded_count ?? 0) }
    : { ok: false, reason: d.reason as CancelSessionReason };
}

export type RemoveBookingReason = 'not_admin' | 'booking_missing' | 'already_cancelled';
export type RemoveBookingResult =
  | { ok: true; refunded: boolean }
  | { ok: false; reason: RemoveBookingReason };
export async function removeBookingRpc(bookingId: Booking['id'], refund: boolean): Promise<RemoveBookingResult> {
  const d = await callRpc('remove_booking', { p_booking_id: bookingId, p_refund: refund });
  return d.ok
    ? { ok: true, refunded: Boolean(d.refunded) }
    : { ok: false, reason: d.reason as RemoveBookingReason };
}

/**
 * level_mismatch and gender_mismatch are BOTH gone (rule 4: display-only,
 * never blocking — gender joined level in the gender-display-only migration;
 * neither the hard-reject path nor the override computation reference either
 * anymore). type_required / invalid_type / type_mismatch are new: an OPEN
 * slot needs a chosen type (type_required if omitted, invalid_type if it
 * isn't one of the four, type_mismatch if it disagrees with an already-typed
 * slot — including a race with a concurrent booking).
 */
export type AdminBookReason =
  | 'not_admin' | 'slot_missing' | 'player_missing' | 'slot_cancelled' | 'slot_in_past'
  | 'no_usable_credit' | 'slot_full' | 'already_booked'
  | 'type_required' | 'invalid_type' | 'type_mismatch';
export type AdminBookResult =
  | { ok: true; bookingId: string; creditBatchId: string; overridden: boolean }
  | { ok: false; reason: AdminBookReason };
/** `trainingType` is the admin's pick for an OPEN slot; null for an already-typed one. */
export async function adminBookPlayerRpc(
  slotId: SlotId,
  playerId: PlayerId,
  override: boolean,
  trainingType: TrainingType | null,
): Promise<AdminBookResult> {
  const d = await callRpc('admin_book_player', {
    p_slot_id: slotId,
    p_player_id: playerId,
    p_override: override,
    p_training_type: trainingType,
  });
  return d.ok
    ? {
        ok: true,
        bookingId: d.booking_id as string,
        creditBatchId: d.credit_batch_id as string,
        overridden: Boolean(d.overridden),
      }
    : { ok: false, reason: d.reason as AdminBookReason };
}

export type GrantReason = 'not_admin' | 'player_missing' | 'reason_required' | 'quantity_below_one';
export type GrantResult = { ok: true; creditBatchId: string } | { ok: false; reason: GrantReason };
export async function grantCreditsRpc(playerId: PlayerId, trainingType: TrainingType, quantity: number, note: string): Promise<GrantResult> {
  const d = await callRpc('grant_credits', { p_player_id: playerId, p_training_type: trainingType, p_quantity: quantity, p_note: note });
  return d.ok ? { ok: true, creditBatchId: d.credit_batch_id as string } : { ok: false, reason: d.reason as GrantReason };
}

export type CashReason =
  | 'not_admin' | 'player_missing' | 'package_missing' | 'trial_not_sellable' | 'package_inactive' | 'amount_below_one';
export type CashResult = { ok: true; purchaseId: string; creditBatchId: string } | { ok: false; reason: CashReason };
export async function recordCashPurchaseRpc(playerId: PlayerId, packageId: PackageId, amount: number): Promise<CashResult> {
  const d = await callRpc('record_cash_purchase', { p_player_id: playerId, p_package_id: packageId, p_amount: amount });
  return d.ok
    ? { ok: true, purchaseId: d.purchase_id as string, creditBatchId: d.credit_batch_id as string }
    : { ok: false, reason: d.reason as CashReason };
}

// ── credit requests (A3/A4) — the approval queue's money mutations ──────────────
export type ApproveRequestReason = 'not_admin' | 'request_missing' | 'not_pending' | 'invalid_quantity' | 'invalid_amount';
export type ApproveRequestResult =
  | { ok: true; alreadyResolved: boolean; purchaseId: string | null }
  | { ok: false; reason: ApproveRequestReason };
/** Approve a request → succeeded purchase + minted credits (revenue once marked paid). granted quantity
 *  and amount are OPTIONAL overrides (null = the package's defaults). Idempotent server-side. */
export async function approveCreditRequestRpc(
  requestId: string,
  grantedQuantity: number | null,
  amount: number | null,
): Promise<ApproveRequestResult> {
  const d = await callRpc('approve_credit_request', {
    p_request_id: requestId,
    p_granted_quantity: grantedQuantity,
    p_amount: amount,
  });
  return d.ok
    ? { ok: true, alreadyResolved: Boolean(d.already_resolved), purchaseId: (d.purchase_id as string) ?? null }
    : { ok: false, reason: d.reason as ApproveRequestReason };
}

export type RejectRequestReason = 'not_admin' | 'request_missing' | 'not_pending' | 'reason_required';
export type RejectRequestResult = { ok: true } | { ok: false; reason: RejectRequestReason };
/** Reject a request with a required reason (shown to the player). Mints nothing. Idempotent. */
export async function rejectCreditRequestRpc(requestId: string, reason: string): Promise<RejectRequestResult> {
  const d = await callRpc('reject_credit_request', { p_request_id: requestId, p_reason: reason });
  return d.ok ? { ok: true } : { ok: false, reason: d.reason as RejectRequestReason };
}

export type SetPurchasePaidReason = 'not_admin' | 'invalid_paid' | 'purchase_missing' | 'not_succeeded';
export type SetPurchasePaidResult =
  | { ok: true; paid: boolean; changed: boolean }
  | { ok: false; reason: SetPurchasePaidReason };
/**
 * Mark a purchase collected (or not). Flips whether it counts toward revenue; never
 * creates or deletes a row, and never touches the credits it granted. Idempotent.
 */
export async function setPurchasePaidRpc(purchaseId: string, paid: boolean): Promise<SetPurchasePaidResult> {
  const d = await callRpc('set_purchase_paid', { p_purchase_id: purchaseId, p_paid: paid });
  return d.ok
    ? { ok: true, paid: Boolean(d.paid), changed: Boolean(d.changed) }
    : { ok: false, reason: d.reason as SetPurchasePaidReason };
}

export type ConfirmReason = 'not_admin' | 'slot_missing' | 'slot_cancelled' | 'slot_in_past';
export type ConfirmResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; reason: ConfirmReason };
export async function confirmSessionRpc(slotId: SlotId): Promise<ConfirmResult> {
  const d = await callRpc('confirm_session', { p_slot_id: slotId });
  return d.ok
    ? { ok: true, alreadyConfirmed: Boolean(d.already_confirmed) }
    : { ok: false, reason: d.reason as ConfirmReason };
}

export type AttendanceStatus = 'booked' | 'attended' | 'no_show';
export type MarkAttendanceReason =
  | 'not_admin' | 'invalid_status' | 'booking_missing' | 'already_cancelled' | 'session_not_started';
export type MarkAttendanceResult = { ok: true; status: AttendanceStatus } | { ok: false; reason: MarkAttendanceReason };
export async function markAttendanceRpc(bookingId: Booking['id'], status: AttendanceStatus): Promise<MarkAttendanceResult> {
  const d = await callRpc('mark_attendance', { p_booking_id: bookingId, p_status: status });
  return d.ok ? { ok: true, status: d.status as AttendanceStatus } : { ok: false, reason: d.reason as MarkAttendanceReason };
}

// ── direct config writes (is_admin()-gated RLS) ────────────────────────────────
async function writeRow<T>(op: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>, map: (r: Record<string, unknown>) => T, what: string): Promise<T> {
  const { data, error } = await op;
  if (error) throw new ApiError(`${what} failed: ${error.message}`, error.code, error);
  return map(data as Record<string, unknown>);
}

export interface CoachFields { name: string; bio: string; photoUrl: string | null; isActive: boolean }
export function insertCoach(fields: CoachFields): Promise<Coach> {
  const id = newId(ID_PREFIXES.coach);
  return writeRow(
    supabase.from('coaches').insert({ id, name: fields.name, bio: fields.bio, photo_url: fields.photoUrl, is_active: fields.isActive }).select().single(),
    rowToCoach, 'Save coach');
}
export function updateCoach(id: CoachId, fields: Partial<CoachFields>): Promise<Coach> {
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.bio !== undefined) patch.bio = fields.bio;
  if (fields.photoUrl !== undefined) patch.photo_url = fields.photoUrl;
  if (fields.isActive !== undefined) patch.is_active = fields.isActive;
  return writeRow(supabase.from('coaches').update(patch).eq('id', id).select().single(), rowToCoach, 'Update coach');
}

export interface PackageFields { trainingType: TrainingType; sessionCount: number; price: number; name: string; isActive: boolean }
export function insertPackage(f: PackageFields): Promise<Package> {
  const id = newId(ID_PREFIXES.package);
  return writeRow(
    supabase.from('packages').insert({ id, training_type: f.trainingType, session_count: f.sessionCount, price: f.price, name: f.name, is_active: f.isActive }).select().single(),
    rowToPackage, 'Save package');
}
export function updatePackage(id: PackageId, f: Partial<PackageFields>): Promise<Package> {
  const patch: Record<string, unknown> = {};
  if (f.trainingType !== undefined) patch.training_type = f.trainingType;
  if (f.sessionCount !== undefined) patch.session_count = f.sessionCount;
  if (f.price !== undefined) patch.price = f.price;
  if (f.name !== undefined) patch.name = f.name;
  if (f.isActive !== undefined) patch.is_active = f.isActive;
  return writeRow(supabase.from('packages').update(patch).eq('id', id).select().single(), rowToPackage, 'Update package');
}

export interface TemplateFields {
  coachId: CoachId; weekday: Weekday; startTime: string; endTime: string;
  trainingType: TrainingType | null; capacity: number; gender: Gender | null; level: Level | null; isActive: boolean;
}
function templateRow(f: TemplateFields): Record<string, unknown> {
  return { coach_id: f.coachId, weekday: f.weekday, start_time: f.startTime, end_time: f.endTime, training_type: f.trainingType, capacity: f.capacity, gender: f.gender, level: f.level, is_active: f.isActive };
}
export function insertTemplate(f: TemplateFields): Promise<AvailabilityTemplate> {
  const id = newId(ID_PREFIXES.availabilityTemplate);
  return writeRow(supabase.from('availability_templates').insert({ id, ...templateRow(f) }).select().single(), rowToAvailabilityTemplate, 'Save template');
}
export function updateTemplate(id: AvailabilityTemplate['id'], f: Partial<TemplateFields>): Promise<AvailabilityTemplate> {
  const patch: Record<string, unknown> = {};
  const full = f as TemplateFields;
  if (f.coachId !== undefined) patch.coach_id = full.coachId;
  if (f.weekday !== undefined) patch.weekday = full.weekday;
  if (f.startTime !== undefined) patch.start_time = full.startTime;
  if (f.endTime !== undefined) patch.end_time = full.endTime;
  if (f.trainingType !== undefined) patch.training_type = full.trainingType;
  if (f.capacity !== undefined) patch.capacity = full.capacity;
  if (f.gender !== undefined) patch.gender = full.gender;
  if (f.level !== undefined) patch.level = full.level;
  if (f.isActive !== undefined) patch.is_active = full.isActive;
  return writeRow(supabase.from('availability_templates').update(patch).eq('id', id).select().single(), rowToAvailabilityTemplate, 'Update template');
}
export type DeleteTemplateReason = 'not_admin' | 'template_missing';
export type DeleteTemplateResult =
  | { ok: true; alreadyDeleted: boolean; cancelledCount: number }
  | { ok: false; reason: DeleteTemplateReason };
/**
 * Retires a recurring rule via the delete_template RPC: cancels every FUTURE
 * session it generated (refunding + notifying through cancel_session, one
 * call per slot — no separate refund path here) and marks the rule deleted.
 * Past sessions are untouched. Idempotent — a second call on an
 * already-deleted rule reports alreadyDeleted, cancels nothing further.
 */
export async function deleteTemplateRpc(id: AvailabilityTemplate['id']): Promise<DeleteTemplateResult> {
  const d = await callRpc('delete_template', { p_template_id: id });
  return d.ok
    ? { ok: true, alreadyDeleted: Boolean(d.already_deleted), cancelledCount: Number(d.cancelled_count ?? 0) }
    : { ok: false, reason: d.reason as DeleteTemplateReason };
}

export type DeletePackageReason = 'not_admin' | 'package_missing' | 'trial_package_protected';
export type DeletePackageResult =
  | { ok: true; action: 'deleted' | 'retired' | 'already_deleted' }
  | { ok: false; reason: DeletePackageReason };
/**
 * Deletes a package via the delete_package RPC: hard-deletes it if nothing has
 * ever referenced it (no purchases, no credit requests), or retires it
 * (deleted_at set, is_active forced false, row + history intact) if it has.
 * The trial package can't be deleted at all — use setPackageSellable instead.
 */
export async function deletePackageRpc(id: PackageId): Promise<DeletePackageResult> {
  const d = await callRpc('delete_package', { p_package_id: id });
  return d.ok
    ? { ok: true, action: d.action as 'deleted' | 'retired' | 'already_deleted' }
    : { ok: false, reason: d.reason as DeletePackageReason };
}

export type RescheduleReason =
  | 'not_admin' | 'slot_missing' | 'slot_cancelled'
  | 'capacity_below_booked' | 'end_before_start' | 'in_past' | 'coach_conflict';
export type RescheduleResult =
  | { ok: true; moved: boolean }
  | { ok: false; reason: RescheduleReason };
/**
 * Reschedule/edit a slot via the reschedule_session RPC (S12). It replaces the old
 * direct column UPDATE so the row change and the "your session moved" notifications
 * to booked players are one atomic, RPC-minted transaction. Returns {ok,reason} data.
 */
export async function rescheduleSessionRpc(
  id: SlotId,
  p: { coachId: CoachId; capacity: number; startsAt: string; endsAt: string },
): Promise<RescheduleResult> {
  const d = await callRpc('reschedule_session', {
    p_slot_id: id, p_coach_id: p.coachId, p_capacity: p.capacity, p_starts_at: p.startsAt, p_ends_at: p.endsAt,
  });
  return d.ok ? { ok: true, moved: Boolean(d.moved) } : { ok: false, reason: d.reason as RescheduleReason };
}

/** Slot update — only the 5 grant-allowed columns; booked_count is never grantable. */
export interface SlotPatch { coachId?: CoachId; capacity?: number; startsAt?: string; endsAt?: string; status?: SessionSlot['status'] }
export function updateSlot(id: SlotId, p: SlotPatch): Promise<SessionSlot> {
  const patch: Record<string, unknown> = {};
  if (p.coachId !== undefined) patch.coach_id = p.coachId;
  if (p.capacity !== undefined) patch.capacity = p.capacity;
  if (p.startsAt !== undefined) patch.starts_at = p.startsAt;
  if (p.endsAt !== undefined) patch.ends_at = p.endsAt;
  if (p.status !== undefined) patch.status = p.status;
  return writeRow(supabase.from('session_slots').update(patch).eq('id', id).select().single(), rowToSlot, 'Update slot');
}

/** Bulk-insert generated slots. booked_count is omitted (not in the insert grant; defaults 0). */
export async function insertSlots(slots: SessionSlot[]): Promise<number> {
  if (slots.length === 0) return 0;
  const rows = slots.map((s) => ({
    id: s.id, coach_id: s.coachId, starts_at: s.startsAt, ends_at: s.endsAt, training_type: s.trainingType,
    capacity: s.capacity, gender: s.gender, level: s.level, status: s.status, template_id: s.templateId,
  }));
  const { error } = await supabase.from('session_slots').insert(rows);
  if (error) throw new ApiError(`Create slots failed: ${error.message}`, error.code, error);
  return slots.length;
}

// ── coach photo upload (Storage) ───────────────────────────────────────────────
const PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Upload a coach headshot to coach-photos/coaches/<coachId>.<ext> and return its
 * public URL. Because the key varies by extension, a jpg→png change would orphan the
 * old file (S10a's flag), so we first delete every coaches/<coachId>.* variant, then
 * upsert the new one — one object per coach, no silent storage growth.
 */
const photoVariants = (coachId: CoachId): string[] =>
  Object.values(PHOTO_EXT).map((e) => `coaches/${coachId}.${e}`);

export async function uploadCoachPhoto(coachId: CoachId, file: File): Promise<string> {
  const ext = PHOTO_EXT[file.type];
  if (!ext) throw new ApiError('Photo must be a JPEG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError('Photo must be under 5 MB.');

  const bucket = supabase.storage.from('coach-photos');
  // Remove any prior extension variants so the coach never has two orphaned files.
  await bucket.remove(photoVariants(coachId));

  const path = `coaches/${coachId}.${ext}`;
  const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new ApiError(`Photo upload failed: ${error.message}`, undefined, error);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Delete a coach's headshot object(s) — the admin delete policy (S10a) allows this. */
export async function deleteCoachPhoto(coachId: CoachId): Promise<void> {
  const { error } = await supabase.storage.from('coach-photos').remove(photoVariants(coachId));
  if (error) throw new ApiError(`Photo delete failed: ${error.message}`, undefined, error);
}

// ── news image upload (Storage) ────────────────────────────────────────────────
/**
 * Upload a news image to news-images/news/<uuid>.<ext> and return its public URL.
 * Unlike coach photos, a news row's id doesn't exist yet at upload time (create_news
 * generates it server-side), so the key is a fresh random id, not the news id — see
 * the news migration's header for why. Always a brand-new key, so no upsert/cleanup
 * of prior variants is needed here (that's what removeNewsImage is for, on edit).
 */
export async function uploadNewsImage(file: File): Promise<{ path: string; publicUrl: string }> {
  const ext = PHOTO_EXT[file.type];
  if (!ext) throw new ApiError('Image must be a JPEG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError('Image must be under 5 MB.');

  const bucket = supabase.storage.from('news-images');
  const path = `news/${crypto.randomUUID()}.${ext}`;
  const { error } = await bucket.upload(path, file, { contentType: file.type });
  if (error) throw new ApiError(`Image upload failed: ${error.message}`, undefined, error);
  return { path, publicUrl: bucket.getPublicUrl(path).data.publicUrl };
}

/** The public URL for an already-uploaded news image's raw storage path. */
export function newsImagePublicUrl(path: string): string {
  return supabase.storage.from('news-images').getPublicUrl(path).data.publicUrl;
}

/** Remove a news image object — used when an edit replaces it, so the old one doesn't orphan. */
export async function removeNewsImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from('news-images').remove([path]);
  if (error) throw new ApiError(`Image delete failed: ${error.message}`, undefined, error);
}
