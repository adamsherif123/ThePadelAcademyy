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

/**
 * How the money reached the academy. `paymob` = the online card gateway (S7, mothballed).
 * `cash` = taken at the desk. `instapay` = an InstaPay bank transfer the player made
 * out-of-band, then reported for crediting (A3). Egypt runs on cash + InstaPay; both are
 * ordinary purchases whose only difference from a card one is the channel. cash/instapay
 * settle immediately (`succeeded`) and carry NO gateway references — only paymob does.
 */
export type PaymentMethod = 'paymob' | 'cash' | 'instapay';

export type BookingStatus = 'booked' | 'cancelled' | 'attended' | 'no_show';

export type SlotStatus = 'published' | 'cancelled';

/**
 * How a CreditBatch came to exist. `purchase` = bought a package. `signup_grant`
 * = the one-time free trial credits every new account receives on creation.
 * `admin_grant` = the owner deliberately comped a player (a rained-out session,
 * goodwill) — a visible free grant, NOT phantom revenue. Only `purchase` batches
 * involve money, so only they carry a `purchaseId` and count as credit liability;
 * both grants have a null purchaseId. See the invariant documented on CreditBatch.
 */
export type CreditSource = 'purchase' | 'signup_grant' | 'admin_grant';

/**
 * The server-side events that mint a notification (S12). Each is emitted inside the
 * RPC that causes it; the client never invents these. `session_confirmed` fires when
 * a session fills or the admin confirms it; the rest track cancels, removals,
 * reschedules, and credit grants.
 */
export type NotificationType =
  | 'session_confirmed'
  | 'session_cancelled'
  | 'removed_from_session'
  | 'session_rescheduled'
  | 'credits_granted';

/**
 * 0 = Sunday ... 6 = Saturday — matches `Date.prototype.getUTCDay()`.
 * The academy's operating window is Sun–Wed (0–3).
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
