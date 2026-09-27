// The query keys, and what each mutation invalidates.
//
// A pure module, with NO react-native import, deliberately. This is the app's
// invalidation surface — what decides whether a screen shows the world as it is
// or as it was a moment ago — and it used to live in queryClient.ts beside a
// NetInfo import, which put it out of reach of the test runner. It is separate so
// the one rule that matters can be asserted (queryKeys.test.ts): while it was
// only a hand-written list, a key went missing and nothing noticed. `slotsByIds`
// arrived in S7b and was left out of BOOKING_TOUCHED_KEYS, so after booking a
// group session the confirmation screen still read the PRE-booking slot and told
// the second player they had started it.

/** The single source of truth for query keys — the invalidation surface. */
export const queryKeys = {
  player: ['player'] as const,
  coaches: ['coaches'] as const,
  /** Branches. Not location-scoped, obviously — this IS the list. */
  locations: ['locations'] as const,
  /**
   * Prefix keys. `packages` and `slots` are read PER BRANCH, so the selected
   * location is appended at the call site and each branch caches separately;
   * invalidating the prefix still refreshes whichever branch is mounted.
   */
  packages: ['packages'] as const,
  templates: ['templates'] as const,
  slots: ['slots'] as const,
  /** Slots fetched BY ID for bookings at a branch the feed is not showing. */
  slotsByIds: ['slotsByIds'] as const,
  creditBatches: ['creditBatches'] as const,
  bookings: ['bookings'] as const,
  /** Prefix key. The windowed list is ['purchases', {since}], the lifetime count
   *  is ['purchases','count'] — invalidating the prefix refreshes both. */
  purchases: ['purchases'] as const,
  purchaseCount: ['purchases', 'count'] as const,
  /** Prefix key, same shape: the paged feed is ['notifications','feed'] and the
   *  unread badge count is ['notifications','unread']. */
  notifications: ['notifications'] as const,
  notificationsFeed: ['notifications', 'feed'] as const,
  notificationsUnread: ['notifications', 'unread'] as const,
  /** The Sessions tab's on-demand pages of sessions older than the slot window. */
  pastSessions: ['pastSessions'] as const,
  creditRequests: ['creditRequests'] as const,
  trialEligible: ['trialEligible'] as const,
  news: ['news'] as const,
  /** app_config — the latest-version value the update prompt compares against. */
  appConfig: ['appConfig'] as const,
  newsSeen: ['newsSeen'] as const,
  /** Coach mode. The schedule is keyed by the coach's own id; hours by month, so
   *  this month and last month are separate cache entries; the roster by slot. */
  coachSlots: ['coachSlots'] as const,
  coachHours: ['coachHours'] as const,
  coachRoster: ['coachRoster'] as const,
  coachDashboard: ['coachDashboard'] as const,
};

/**
 * Every key under which SLOT ROWS are cached for the PLAYER app.
 *
 * Any booking or cancellation changes `booked_count` on a slot, so all of them go
 * stale the instant one lands. They are listed here once and SPREAD into
 * BOOKING_TOUCHED_KEYS below, rather than written out there by hand — which is
 * how one of them came to be missing. A new slot cache goes HERE, and
 * queryKeys.test.ts fails if a key that looks like one does not.
 *
 * `coachSlots` is deliberately excluded: that is the coach's schedule on the
 * coach's device, and a player booking on this phone cannot invalidate a cache on
 * somebody else's.
 */
export const SLOT_BEARING_KEYS = [queryKeys.slots, queryKeys.slotsByIds] as const;

/** What a booking/cancellation changes: the wallet, the player's bookings, and seat counts. */
export const BOOKING_TOUCHED_KEYS = [
  queryKeys.creditBatches,
  queryKeys.bookings,
  ...SLOT_BEARING_KEYS,
] as const;
