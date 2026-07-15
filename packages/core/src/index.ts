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
  GENDERS,
  LEVELS,
  PIASTRES_PER_EGP,
  PURCHASE_STATUSES,
  SLOT_STATUSES,
  TRAINING_TYPES,
  WEEKDAYS,
} from './constants';

export { ID_PREFIXES, newId, type IdPrefix } from './ids';

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
  formatExpiry,
  formatInstantDate,
  formatInstantTime,
  formatPiastres,
  formatSessionTimeRange,
} from './format';

export {
  canBookSlot,
  isBatchUsable,
  isCancellableWithoutForfeit,
  isGroupSlot,
  slotRemainingCapacity,
  type BookBlockReason,
  type CanBookResult,
} from './rules';
