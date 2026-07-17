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
  Coach,
  CoachId,
  CreditBatch,
  Gender,
  Level,
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
export const fetchPlayers = (): Promise<Player[]> => selectAll('players', rowToPlayer);
export const fetchPackages = (): Promise<Package[]> => selectAll('packages', rowToPackage);
export const fetchTemplates = (): Promise<AvailabilityTemplate[]> =>
  selectAll('availability_templates', rowToAvailabilityTemplate);
export const fetchSlots = (): Promise<SessionSlot[]> => selectAll('session_slots', rowToSlot);
export const fetchCreditBatches = (): Promise<CreditBatch[]> => selectAll('credit_batches', rowToCreditBatch);
export const fetchBookings = (): Promise<Booking[]> => selectAll('bookings', rowToBooking);
export const fetchPurchases = (): Promise<Purchase[]> => selectAll('purchases', rowToPurchase);

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

export type AdminBookReason =
  | 'not_admin' | 'slot_missing' | 'player_missing' | 'slot_cancelled' | 'slot_in_past'
  | 'gender_mismatch' | 'level_mismatch' | 'no_usable_credit' | 'slot_full' | 'already_booked';
export type AdminBookResult =
  | { ok: true; bookingId: string; creditBatchId: string }
  | { ok: false; reason: AdminBookReason };
export async function adminBookPlayerRpc(slotId: SlotId, playerId: PlayerId, override: boolean): Promise<AdminBookResult> {
  const d = await callRpc('admin_book_player', { p_slot_id: slotId, p_player_id: playerId, p_override: override });
  return d.ok
    ? { ok: true, bookingId: d.booking_id as string, creditBatchId: d.credit_batch_id as string }
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
  trainingType: TrainingType; capacity: number; gender: Gender | null; level: Level | null; isActive: boolean;
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
export async function deleteTemplate(id: AvailabilityTemplate['id']): Promise<void> {
  const { error } = await supabase.from('availability_templates').delete().eq('id', id);
  if (error) throw new ApiError(`Delete template failed: ${error.message}`, error.code, error);
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
export async function uploadCoachPhoto(coachId: CoachId, file: File): Promise<string> {
  const ext = PHOTO_EXT[file.type];
  if (!ext) throw new ApiError('Photo must be a JPEG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new ApiError('Photo must be under 5 MB.');

  const bucket = supabase.storage.from('coach-photos');
  // Remove any prior extension variants so the coach never has two orphaned files.
  await bucket.remove(Object.values(PHOTO_EXT).map((e) => `coaches/${coachId}.${e}`));

  const path = `coaches/${coachId}.${ext}`;
  const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new ApiError(`Photo upload failed: ${error.message}`, undefined, error);
  return bucket.getPublicUrl(path).data.publicUrl;
}
