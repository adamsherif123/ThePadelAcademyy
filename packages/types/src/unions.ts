/**
 * String-literal unions — deliberately NOT TypeScript `enum`s, which would emit
 * runtime objects and break the zero-JavaScript guarantee of this package.
 *
 * @tpa/core re-exports runtime arrays (TRAINING_TYPES, LEVELS, ...) derived from
 * these unions with `satisfies readonly <Union>[]`, so the arrays can never
 * silently drift out of sync with the types.
 */

/** trial = one-off taster; group/duo/individual = the ongoing formats. */
export type TrainingType = 'trial' | 'group' | 'duo' | 'individual';

export type Level = 'beginner' | 'adv_beginner' | 'intermediate';

/** The academy runs men's and ladies' group training separately. */
export type Gender = 'men' | 'ladies';

/** Client may only ever create `pending`; only a verified webhook advances it. */
export type PurchaseStatus = 'pending' | 'succeeded' | 'failed';

export type BookingStatus = 'booked' | 'cancelled' | 'attended' | 'no_show';

export type SlotStatus = 'published' | 'cancelled';

/**
 * 0 = Sunday ... 6 = Saturday — matches `Date.prototype.getUTCDay()`.
 * The academy's operating window is Sun–Wed (0–3).
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
