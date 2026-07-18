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
  rowToPackage,
  rowToPlayer,
  rowToPurchase,
  rowToSlot,
} from './mappers';

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

/** The signed-in player's own row (RLS returns exactly zero or one). null = no profile yet. */
export async function fetchCurrentPlayer(): Promise<Player | null> {
  const { data, error } = await supabase.from('players').select('*').maybeSingle();
  if (error) throw new ApiError(`Failed to load player: ${error.message}`, error);
  return data ? rowToPlayer(data) : null;
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

export type SignupReason = 'name_required' | 'invalid_gender' | 'invalid_level' | 'not_authenticated';

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
