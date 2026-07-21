// The data access layer: typed reads (PostgREST) and money mutations (RPCs).
//
// Reads are scoped by RLS to the caller — `fetchCreditBatches` returns only the
// signed-in player's batches because the policy says so, not because we filter.
// Mutations are the SECURITY DEFINER RPCs; each returns `{ ok, reason }` as DATA
// (never an HTTP error), so a business rejection like `slot_full` arrives as a
// value we can map to copy, and only transport failures throw.
import { ID_PREFIXES, newId, type BookBlockReason } from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  BookingId,
  Coach,
  CreditBatch,
  Gender,
  IsoInstant,
  Level,
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
} from '@tpa/types';

import { supabase } from './supabase';
import {
  rowToAvailabilityTemplate,
  rowToBooking,
  rowToCoach,
  rowToCreditBatch,
  rowToNotification,
  rowToPackage,
  rowToPlayer,
  rowToPurchase,
  rowToSlot,
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

// ── reads ────────────────────────────────────────────────────────────────────
// Each throws ApiError on transport failure so React Query can retry/surface it.

async function selectAll<T>(table: string, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new ApiError(`Failed to load ${table}: ${error.message}`, error);
  return (data ?? []).map(map);
}

export const fetchCoaches = (): Promise<Coach[]> => selectAll('coaches', rowToCoach);
// A signed-in (authenticated) player reads ACTIVE templates via RLS policy
// `availability_templates_select_active` (S5.1) — this is how the client knows the
// academy's operating weekdays. Anon cannot read them; these screens are behind auth.
export const fetchTemplates = (): Promise<AvailabilityTemplate[]> =>
  selectAll('availability_templates', rowToAvailabilityTemplate);
export const fetchPackages = (): Promise<Package[]> => selectAll('packages', rowToPackage);
export const fetchSlots = (): Promise<SessionSlot[]> => selectAll('session_slots', rowToSlot);
export const fetchCreditBatches = (): Promise<CreditBatch[]> =>
  selectAll('credit_batches', rowToCreditBatch);
export const fetchBookings = (): Promise<Booking[]> => selectAll('bookings', rowToBooking);
export const fetchPurchases = (): Promise<Purchase[]> => selectAll('purchases', rowToPurchase);

/** One purchase by id (for the return-journey poll). RLS scopes it to the caller. */
export async function fetchPurchaseById(id: string): Promise<Purchase | null> {
  const { data, error } = await supabase.from('purchases').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(`Failed to load purchase: ${error.message}`, error);
  return data ? rowToPurchase(data) : null;
}

// ── notifications (S12.x client) ───────────────────────────────────────────────
// Reads are RLS-scoped to the caller; the only writable column is read_at. Rows are
// never inserted from the client — the event RPCs mint them via tpa.notify.

/** The player's notifications, newest first (RLS returns only their own). */
export async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new ApiError(`Failed to load notifications: ${error.message}`, error);
  return (data ?? []).map(rowToNotification);
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

export type BookReason =
  | BookBlockReason
  | 'slot_missing'
  | 'already_booked'
  | 'not_authenticated';

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
  | 'is_admin'; // A1/A2: an admin identity can never become a player (defence in depth)

export type SignupRpcResult =
  | { ok: true; alreadyCompleted: boolean; playerId: string }
  | { ok: false; reason: SignupReason };

/** Run an RPC with an abort timeout so a stalled request can't spin forever. */
async function callRpc(fn: string, argsPayload: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase
    .rpc(fn, argsPayload)
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
  if (error) throw new ApiError(`${fn} failed: ${error.message}`, error);
  return data;
}

export async function bookSlotRpc(slotId: SlotId): Promise<BookRpcResult> {
  const d = (await callRpc('book_slot', { p_slot_id: slotId })) as Record<string, unknown>;
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

export async function completeSignupRpc(draft: {
  name: string;
  gender: Gender;
  level: Level;
}): Promise<SignupRpcResult> {
  const d = (await callRpc('complete_signup', {
    p_name: draft.name,
    p_gender: draft.gender,
    p_level: draft.level,
  })) as Record<string, unknown>;
  if (d.ok) {
    return { ok: true, alreadyCompleted: Boolean(d.already_completed), playerId: d.player_id as string };
  }
  return { ok: false, reason: d.reason as SignupReason };
}
