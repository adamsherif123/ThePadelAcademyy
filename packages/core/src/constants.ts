import type {
  BookingStatus,
  CreditSource,
  Gender,
  Level,
  PaymentMethod,
  PurchaseStatus,
  SlotStatus,
  TrainingType,
  Weekday,
} from '@tpa/types';

/** 1 EGP = 100 piastres. All money is integer piastres. */
export const PIASTRES_PER_EGP = 100;

/**
 * Credits expire this many days after the batch is created — the SAME rule for
 * purchased credits and for signup-grant trial credits. There is deliberately no
 * second expiry rule.
 *
 * MIRRORED IN SQL as `tpa.credit_expiry()` (interval '40 days'), originally
 * defined in supabase/migrations/20260718000005_s7a_booking_rpcs.sql and
 * redefined (30 -> 40, future mints only — see that migration's header for why
 * existing credit_batches rows are untouched) in
 * supabase/migrations/20260819000039_credit_expiry_40.sql. Changing this number
 * means changing that function too; sql-parity.test.ts reads both and fails if
 * they drift.
 */
export const CREDIT_EXPIRY_DAYS = 40;

/**
 * A news item is visible to players for this many days after it's published —
 * a client-side query filter (`created_at > now - NEWS_VISIBILITY_DAYS days`),
 * NOT a server-side rule: RLS lets an authenticated player read every news row
 * regardless of age (the admin's own News tab always sees full history), so
 * there is no SQL-side function to mirror here the way credit expiry has one.
 */
export const NEWS_VISIBILITY_DAYS = 30;

/**
 * Free trial credits granted once, on account creation. Single source of truth —
 * this number is expected to change (the owner may cut it to 1), so nothing else
 * may hardcode it. Consumed by @tpa/core's `buildSignupGrant`.
 */
export const SIGNUP_TRIAL_CREDITS = 2;

/**
 * A still-valid credit batch within this many days of expiry is classified
 * `expiring_soon` (drives the wallet's amber StatusChip and Home's expiry notice).
 * Set to 3 (down from 7) so "expiring soon" has ONE meaning that matches the
 * Home nag; a batch 4+ days out reads green, and its chip still states the real
 * day count. See `creditExpiryState`.
 */
export const EXPIRING_SOON_DAYS = 3;

/**
 * Free cancellation + credit refund is allowed up to this many hours before a
 * slot starts. Inside the window the credit is forfeited; a no-show forfeits too.
 * Evaluated at cancel-time against the live DB clock — bumping this number only
 * changes the outcome of cancellations from now on, never retroactively.
 *
 * MIRRORED IN SQL as `tpa.cancellation_window()`, originally interval '3 hours' in
 * supabase/migrations/20260718000005_s7a_booking_rpcs.sql, bumped to interval '5
 * hours' in supabase/migrations/20260820000040_cancellation_window_5h.sql, which
 * the cancel_booking RPC enforces with the DB clock. Changing this number means
 * changing that function too; sql-parity.test.ts reads both and fails if they drift.
 */
export const CANCELLATION_WINDOW_HOURS = 5;

/**
 * An EMPTY slot (zero bookings) cannot be booked within this many hours of its
 * starts_at — once it has at least one booking, the window no longer applies to
 * later bookers on the same slot. A different rule from CANCELLATION_WINDOW_HOURS
 * (that one governs refund-vs-forfeit on a cancel; this one governs whether a
 * FIRST booking is allowed at all) — they happen to share the same 5-hour figure
 * today, but are two independently named constants on purpose, not one reused
 * number, so changing one doesn't silently change the other's meaning.
 *
 * MIRRORED IN SQL as `tpa.booking_window()` in
 * supabase/migrations/20260820000041_booking_window_guard.sql, which book_slot
 * enforces inside its guarded UPDATE. Changing this number means changing that
 * function too; sql-parity.test.ts reads both and fails if they drift. The CLIENT
 * feed filter that hides these slots (added in a later session) must read this
 * same constant, never a second hardcoded 5.
 */
export const BOOKING_WINDOW_HOURS = 5;

/** All instants render in this zone. Stored data is always UTC. */
export const CAIRO_TZ = 'Africa/Cairo';

/**
 * The seat ceiling a session type implies. This is the ONE canonical
 * type→capacity mapping — the admin's create-form default (an open slot's
 * capacity is otherwise whatever the admin typed) AND the number book_slot /
 * admin_book_player force capacity to the moment a booking fixes a
 * previously-OPEN slot's type (mirroring the individual-forces-1 rule to every
 * type, not just individual). An admin who pre-sets a type at creation keeps
 * their own explicit capacity — this map only fires for a booking-driven
 * type-set, never overwriting a deliberate admin number.
 *
 * MIRRORED IN SQL as `tpa.canonical_capacity(text)` in
 * supabase/migrations/20260809000028_open_slot_capacity_fix.sql. Changing a
 * number here means changing that function too; sql-parity.test.ts reads both
 * and fails if they drift.
 */
export const CANONICAL_CAPACITY: Record<TrainingType, number> = {
  trial: 1,
  individual: 1,
  duo: 2,
  group: 4,
};

/**
 * Runtime arrays derived from the type unions. The `satisfies` clause rejects a
 * value that isn't a member of the union; the `Covers` assertion below rejects a
 * union member that's MISSING from the array. Together they make it impossible
 * for these arrays to drift out of sync with the types in either direction.
 */
export const TRAINING_TYPES = [
  'trial',
  'group',
  'duo',
  'individual',
] as const satisfies readonly TrainingType[];

export const LEVELS = [
  'beginner',
  'adv_beginner',
  'intermediate',
] as const satisfies readonly Level[];

export const GENDERS = ['men', 'ladies'] as const satisfies readonly Gender[];

export const PURCHASE_STATUSES = [
  'pending',
  'succeeded',
  'failed',
] as const satisfies readonly PurchaseStatus[];

export const BOOKING_STATUSES = [
  'booked',
  'cancelled',
  'attended',
  'no_show',
] as const satisfies readonly BookingStatus[];

export const SLOT_STATUSES = ['published', 'cancelled'] as const satisfies readonly SlotStatus[];

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly Weekday[];

export const CREDIT_SOURCES = [
  'purchase',
  'signup_grant',
  'admin_grant',
] as const satisfies readonly CreditSource[];

export const PAYMENT_METHODS = ['paymob', 'cash', 'instapay'] as const satisfies readonly PaymentMethod[];

// --- Exhaustiveness guards: fail compilation if an array omits a union member ---
type Covers<Arr extends readonly unknown[], U> = [Exclude<U, Arr[number]>] extends [never]
  ? true
  : ['MISSING FROM ARRAY:', Exclude<U, Arr[number]>];
type Assert<_T extends true> = never;

// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversTrainingTypes = Assert<Covers<typeof TRAINING_TYPES, TrainingType>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversLevels = Assert<Covers<typeof LEVELS, Level>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversGenders = Assert<Covers<typeof GENDERS, Gender>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversPurchaseStatuses = Assert<Covers<typeof PURCHASE_STATUSES, PurchaseStatus>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversBookingStatuses = Assert<Covers<typeof BOOKING_STATUSES, BookingStatus>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversSlotStatuses = Assert<Covers<typeof SLOT_STATUSES, SlotStatus>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversWeekdays = Assert<Covers<typeof WEEKDAYS, Weekday>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversCreditSources = Assert<Covers<typeof CREDIT_SOURCES, CreditSource>>;
// Exported so `noUnusedLocals` in consuming apps doesn't flag them; intentionally
// NOT re-exported from index.ts, so they stay out of @tpa/core's public API.
export type _CoversPaymentMethods = Assert<Covers<typeof PAYMENT_METHODS, PaymentMethod>>;
