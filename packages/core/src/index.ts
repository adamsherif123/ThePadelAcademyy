/**
 * @tpa/core — pure, dependency-free runtime shared by the mobile app (Hermes),
 * the admin app (browser), and the Edge Functions (Deno). No I/O, no clock reads
 * (predicates take `now`), no date library (native Intl only). The one place that
 * formats money/dates/times, the DST-aware template materializer, the domain
 * constants, and the client-side preview of the booking rules all live here.
 */
export {
  BOOKING_STATUSES,
  BOOKING_WINDOW_HOURS,
  CAIRO_TZ,
  CANCELLATION_WINDOW_HOURS,
  CANONICAL_CAPACITY,
  CREDIT_EXPIRY_DAYS,
  CREDIT_SOURCES,
  EXPIRING_SOON_DAYS,
  GENDERS,
  LEVELS,
  NEWS_VISIBILITY_DAYS,
  PAYMENT_METHODS,
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
  unusedCreditValue,
  type CreditExpiryState,
} from './credits';

export { buildCashPurchase, cashPurchaseHasNoGatewayRefs } from './purchases';

export {
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  cairoOffsetMs,
  cairoWallTimeToInstant,
  cairoWeekStart,
  materializeTemplateSlot,
  parseInstant,
  parseLocalTime,
  sameCairoDate,
  toInstant,
  type CairoDate,
} from './time';

export { isDayOpen, templateCoveredWeekdays } from './availability';

export {
  formatCompactEgp,
  formatDayMonth,
  formatExpiry,
  formatHour,
  formatInstantDate,
  formatRelativeTime,
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
  bookableTypesFor,
  canBookSlot,
  cancellationDeadline,
  isBatchUsable,
  isCancellableWithoutForfeit,
  isGroupSlot,
  isSessionConfirmed,
  slotRemainingCapacity,
  spotsUntilConfirmed,
  type BookableType,
  type BookBlockReason,
  type CanBookResult,
} from './rules';
