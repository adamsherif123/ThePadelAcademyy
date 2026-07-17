/**
 * @tpa/core — pure, dependency-free runtime shared by the mobile app (Hermes),
 * the admin app (browser), and the Edge Functions (Deno). No I/O, no clock reads
 * (predicates take `now`), no date library (native Intl only). The one place that
 * formats money/dates/times, the DST-aware template materializer, the domain
 * constants, and the client-side preview of the booking rules all live here.
 */
export {
  BOOKING_STATUSES,
  CAIRO_TZ,
  CANCELLATION_WINDOW_HOURS,
  CREDIT_EXPIRY_DAYS,
  CREDIT_SOURCES,
  EXPIRING_SOON_DAYS,
  GENDERS,
  LEVELS,
  PIASTRES_PER_EGP,
  PURCHASE_STATUSES,
  SIGNUP_TRIAL_CREDITS,
  SLOT_STATUSES,
  TRAINING_TYPES,
  WEEKDAYS,
} from './constants';

export { ID_PREFIXES, newId, type IdPrefix } from './ids';

export {
  buildAdminGrant,
  buildPurchaseCredits,
  buildSignupGrant,
  creditExpiryState,
  isPurchaseBacked,
  type CreditExpiryState,
} from './credits';

export {
  cairoCalendarDate,
  cairoOffsetMs,
  cairoWallTimeToInstant,
  materializeTemplateSlot,
  parseInstant,
  parseLocalTime,
  toInstant,
} from './time';

export {
  formatCompactEgp,
  formatDayMonth,
  formatExpiry,
  formatHour,
  formatInstantDate,
  formatInstantTime,
  formatLocalTime,
  formatLocalTimeRange,
  formatMonthDay,
  formatPiastres,
  formatSessionTimeRange,
} from './format';

export {
  buildAvailabilityTemplate,
  templateRequiresGenderLevel,
  type TemplateDraft,
  type TemplateInvalidReason,
} from './templates';

export {
  canBookSlot,
  cancellationDeadline,
  isBatchUsable,
  isCancellableWithoutForfeit,
  isGroupSlot,
  slotRemainingCapacity,
  type BookBlockReason,
  type CanBookResult,
} from './rules';
