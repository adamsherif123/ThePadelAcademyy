import type {
  BookingStatus,
  CreditSource,
  Gender,
  Level,
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
 */
export const CREDIT_EXPIRY_DAYS = 30;

/**
 * Free trial credits granted once, on account creation. Single source of truth —
 * this number is expected to change (the owner may cut it to 1), so nothing else
 * may hardcode it. Consumed by @tpa/core's `buildSignupGrant`.
 */
export const SIGNUP_TRIAL_CREDITS = 2;

/**
 * A still-valid credit batch within this many days of expiry is classified
 * `expiring_soon` (drives the wallet's amber warning). See `creditExpiryState`.
 */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Free cancellation + credit refund is allowed up to this many hours before a
 * slot starts. Inside the window the credit is forfeited; a no-show forfeits too.
 */
export const CANCELLATION_WINDOW_HOURS = 3;

/** All instants render in this zone. Stored data is always UTC. */
export const CAIRO_TZ = 'Africa/Cairo';

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
] as const satisfies readonly CreditSource[];

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
