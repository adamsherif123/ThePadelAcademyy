// Postgres speaks snake_case; @tpa/types speaks camelCase branded types. These
// mappers are the one place that translation happens, so every query and RPC in
// the app hands the rest of the codebase real domain objects. Casts are used only
// to re-apply the brands the DB columns can't carry — the shapes are checked by
// the domain types the mappers return.
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CreditBatch,
  IsoInstant,
  LocalTime,
  Notification,
  Package,
  Player,
  Purchase,
  SessionSlot,
  Weekday,
} from '@tpa/types';

/** A raw row from PostgREST: column name → value, with unknown value types. */
type Row = Record<string, unknown>;

const str = (v: unknown): string => v as string;
const num = (v: unknown): number => v as number;
const bool = (v: unknown): boolean => v as boolean;
const iso = (v: unknown): IsoInstant => v as IsoInstant;
const nstr = (v: unknown): string | null => (v == null ? null : (v as string));

export function rowToPlayer(r: Row): Player {
  return {
    id: str(r.id) as Player['id'],
    phone: nstr(r.phone),
    email: nstr(r.email),
    name: str(r.name),
    gender: str(r.gender) as Player['gender'],
    level: str(r.level) as Player['level'],
    createdAt: iso(r.created_at),
  };
}

export function rowToCoach(r: Row): Coach {
  return {
    id: str(r.id) as Coach['id'],
    name: str(r.name),
    bio: str(r.bio),
    photoUrl: nstr(r.photo_url),
    isActive: bool(r.is_active),
  };
}

export function rowToPackage(r: Row): Package {
  return {
    id: str(r.id) as Package['id'],
    trainingType: str(r.training_type) as Package['trainingType'],
    sessionCount: num(r.session_count),
    price: num(r.price) as Package['price'],
    name: str(r.name),
    isActive: bool(r.is_active),
  };
}

export function rowToPurchase(r: Row): Purchase {
  return {
    id: str(r.id) as Purchase['id'],
    playerId: str(r.player_id) as Purchase['playerId'],
    packageId: str(r.package_id) as Purchase['packageId'],
    status: str(r.status) as Purchase['status'],
    amount: num(r.amount) as Purchase['amount'],
    createdAt: iso(r.created_at),
    // The DB has no payment_method column yet (S6 adds the gateway); the only
    // purchases today are cash settlements, recorded server-side.
    paymentMethod: (r.payment_method as Purchase['paymentMethod']) ?? 'cash',
    gatewayOrderId: nstr(r.gateway_order_id),
    gatewayTransactionId: nstr(r.gateway_transaction_id),
  };
}

export function rowToCreditBatch(r: Row): CreditBatch {
  return {
    id: str(r.id) as CreditBatch['id'],
    playerId: str(r.player_id) as CreditBatch['playerId'],
    source: str(r.source) as CreditBatch['source'],
    purchaseId: (nstr(r.purchase_id) as CreditBatch['purchaseId']) ?? null,
    trainingType: str(r.training_type) as CreditBatch['trainingType'],
    quantityTotal: num(r.quantity_total),
    quantityRemaining: num(r.quantity_remaining),
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
    note: nstr(r.note),
  };
}

export function rowToSlot(r: Row): SessionSlot {
  return {
    id: str(r.id) as SessionSlot['id'],
    coachId: str(r.coach_id) as SessionSlot['coachId'],
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    trainingType: str(r.training_type) as SessionSlot['trainingType'],
    capacity: num(r.capacity),
    bookedCount: num(r.booked_count),
    gender: (r.gender as SessionSlot['gender']) ?? null,
    level: (r.level as SessionSlot['level']) ?? null,
    status: str(r.status) as SessionSlot['status'],
    templateId: (nstr(r.template_id) as SessionSlot['templateId']) ?? null,
    manuallyConfirmedAt: nstr(r.manually_confirmed_at) as IsoInstant | null,
  };
}

export function rowToAvailabilityTemplate(r: Row): AvailabilityTemplate {
  // Postgres `time` comes back as "HH:mm:ss"; LocalTime is Cairo-local "HH:mm".
  const hhmm = (v: unknown): LocalTime => str(v).slice(0, 5) as LocalTime;
  return {
    id: str(r.id) as AvailabilityTemplate['id'],
    coachId: str(r.coach_id) as AvailabilityTemplate['coachId'],
    weekday: num(r.weekday) as Weekday,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    trainingType: str(r.training_type) as AvailabilityTemplate['trainingType'],
    capacity: num(r.capacity),
    gender: (r.gender as AvailabilityTemplate['gender']) ?? null,
    level: (r.level as AvailabilityTemplate['level']) ?? null,
    isActive: bool(r.is_active),
  };
}

export function rowToBooking(r: Row): Booking {
  return {
    id: str(r.id) as Booking['id'],
    slotId: str(r.slot_id) as Booking['slotId'],
    playerId: str(r.player_id) as Booking['playerId'],
    creditBatchId: str(r.credit_batch_id) as Booking['creditBatchId'],
    status: str(r.status) as Booking['status'],
    bookedAt: iso(r.booked_at),
    cancelledAt: nstr(r.cancelled_at) as IsoInstant | null,
  };
}

export function rowToNotification(r: Row): Notification {
  return {
    id: str(r.id) as Notification['id'],
    playerId: str(r.player_id) as Notification['playerId'],
    type: str(r.type) as Notification['type'],
    slotId: nstr(r.slot_id) as Notification['slotId'],
    bookingId: nstr(r.booking_id) as Notification['bookingId'],
    title: str(r.title),
    body: str(r.body),
    createdAt: iso(r.created_at),
    readAt: nstr(r.read_at) as IsoInstant | null,
  };
}
