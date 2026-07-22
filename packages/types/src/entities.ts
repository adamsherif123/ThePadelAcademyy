import type {
  AvailabilityTemplateId,
  BookingId,
  CoachId,
  CreditBatchId,
  CreditRequestId,
  NotificationId,
  PackageId,
  PlayerId,
  PurchaseId,
  SlotId,
} from './ids';
import type { Piastres } from './money';
import type { IsoInstant, LocalTime } from './temporal';
import type {
  BookingStatus,
  CreditRequestStatus,
  CreditSource,
  Gender,
  Level,
  NotificationType,
  PaymentMethod,
  PurchaseStatus,
  SlotStatus,
  TrainingType,
  Weekday,
} from './unions';

export interface Player {
  id: PlayerId;
  /**
   * Nullable since A2: consumer auth moved from phone-OTP to email/password, so a player
   * signs up with an email and phone is now an OPTIONAL create-account field (A2.1). Stored
   * as +20 E.164; the deletion tombstone writes a 'deleted:'||id sentinel.
   */
  phone: string | null;
  /**
   * The player's email (A2.1). Set server-side by complete_signup from the auth user, held
   * here so it's queryable (sign-in routing + admin search). Nullable: retired/anonymised
   * rows have it nulled, and it mirrors auth.users (UNIQUE — one player per email). Optional
   * like deletedAt — the row mapper always populates it; fixtures may omit it.
   */
  email?: string | null;
  /**
   * Self-reported at signup (A5): has this player trained at TPA before? Trusted, not
   * verified. null for players created before A5. Surfaced to the admin for context when
   * approving a trial (a "new" member who isn't). Optional — most paths don't read it.
   */
  trainedBefore?: boolean | null;
  name: string;
  gender: Gender;
  level: Level;
  createdAt: IsoInstant;
  /**
   * Set when the account was deleted (anonymise-and-retain, S6.x): the row survives so
   * bookings/purchases keep their FK, but the person is hidden from operational admin
   * lists. Optional — most code paths don't care, and it's null/absent for a live player.
   */
  deletedAt?: IsoInstant | null;
}

export interface Coach {
  id: CoachId;
  name: string;
  bio: string;
  /** Nullable: a coach may have no photo yet. */
  photoUrl: string | null;
  isActive: boolean;
}

/**
 * A purchasable bundle. Buying it grants `sessionCount` credits, all of
 * `trainingType`. `price` is the total for the bundle (integer piastres).
 */
export interface Package {
  id: PackageId;
  trainingType: TrainingType;
  /** Whole sessions granted; integer >= 1. */
  sessionCount: number;
  price: Piastres;
  name: string;
  isActive: boolean;
}

/**
 * A payment attempt. The client may ONLY ever insert one with status `pending`;
 * only a verified payment-gateway webhook (S7) advances it to `succeeded` /
 * `failed`. `amount` is what was charged, captured on the purchase so historical
 * rows are immune to later package repricing.
 */
export interface Purchase {
  id: PurchaseId;
  playerId: PlayerId;
  packageId: PackageId;
  status: PurchaseStatus;
  amount: Piastres;
  createdAt: IsoInstant;
  /** How the money was taken: the Paymob card gateway, or cash at the desk. */
  paymentMethod: PaymentMethod;
  /** Gateway order handle; null until the gateway is engaged (always null for cash). */
  gatewayOrderId: string | null;
  /** Gateway transaction handle; null until a transaction exists (always null for cash). */
  gatewayTransactionId: string | null;
}

/**
 * A player's request to be credited for a payment they've ALREADY made out-of-band —
 * an InstaPay transfer or cash at the desk (A3). It's a CLAIM; the admin's approval is
 * the truth (it mints a real `purchase` + credits, linked via `purchaseId`). Never
 * `paymob` here — that's the online gateway, not a reported payment. Resolution fields
 * are set together on resolve: `approved` → `purchaseId`, `rejected` → `rejectReason`.
 */
export interface CreditRequest {
  id: CreditRequestId;
  playerId: PlayerId;
  packageId: PackageId;
  paymentMethod: 'instapay' | 'cash';
  /** True if this request is for the once-per-player trial package (A5). */
  isTrial: boolean;
  /** Storage key of the uploaded proof screenshot in the private payment-proofs bucket; optional. */
  proofPath: string | null;
  status: CreditRequestStatus;
  createdAt: IsoInstant;
  resolvedAt: IsoInstant | null;
  /** The admin (admins.id) who resolved it; null while pending. */
  resolvedBy: string | null;
  /** Present iff rejected — shown to the player. */
  rejectReason: string | null;
  /** The succeeded purchase minted on approval; null otherwise. */
  purchaseId: PurchaseId | null;
}

/**
 * A typed wallet of credits. Credits are TYPED: a batch of `trainingType` can
 * only pay for a slot of the same `trainingType` (a 350 EGP/session group credit
 * must never book a 1000 EGP/session individual slot). Credits expire —
 * `expiresAt` lives on the batch (CREDIT_EXPIRY_DAYS from creation) so a refund
 * can restore a credit with its original expiry.
 *
 * A batch is created either by a succeeded Purchase or by the one-time free
 * trial grant every new account receives on signup (see `source`).
 *
 * INVARIANT: `source === 'purchase'` ⟺ `purchaseId !== null`. Equivalently,
 * `source === 'signup_grant'` batches always have `purchaseId === null`. This is
 * deliberately NOT modelled as a discriminated union: the shape mirrors flat,
 * nullable S5 columns, and the DB enforces the invariant with a CHECK constraint.
 * @tpa/core's `isPurchaseBacked` guard is the runtime/type mirror (cf.
 * `isGroupSlot`).
 */
export interface CreditBatch {
  id: CreditBatchId;
  playerId: PlayerId;
  source: CreditSource;
  /** Non-null iff `source === 'purchase'`; null for signup grants. */
  purchaseId: PurchaseId | null;
  trainingType: TrainingType;
  quantityTotal: number;
  quantityRemaining: number;
  expiresAt: IsoInstant;
  createdAt: IsoInstant;
  /**
   * Free-text reason, set only for `admin_grant` — WHY the owner comped this
   * player (so it's explicable in an audit six months later). Null for purchases
   * and signup grants.
   */
  note: string | null;
}

/**
 * A recurring weekly availability rule in Cairo LOCAL wall-clock time (not an
 * instant). Materialized into concrete SessionSlots by @tpa/core.
 *
 * `gender` / `level` are only meaningful for `group` training (the academy
 * separates men/ladies and places by level); they are null for trial/duo/
 * individual. See the same nullable invariant on SessionSlot.
 */
export interface AvailabilityTemplate {
  id: AvailabilityTemplateId;
  coachId: CoachId;
  weekday: Weekday;
  startTime: LocalTime;
  endTime: LocalTime;
  trainingType: TrainingType;
  /** Max players the generated slot holds; integer >= 1. */
  capacity: number;
  gender: Gender | null;
  level: Level | null;
  isActive: boolean;
}

/**
 * A concrete bookable session at a fixed instant.
 *
 * `capacity` is the SINGLE source of truth for how many players fit. There is
 * deliberately NO separate single/multi flag: "Single" is a UI toggle that just
 * means capacity 1. `bookedCount` tracks live occupancy (0..capacity).
 *
 * `gender` / `level`: non-null only for `group` slots; null otherwise. The
 * invariant is enforced by @tpa/core (`isGroupSlot`) rather than the type, so the
 * shape maps 1:1 to the flat, nullable S5 columns.
 */
export interface SessionSlot {
  id: SlotId;
  coachId: CoachId;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
  trainingType: TrainingType;
  /** Integer >= 1. The only thing that decides how many players fit. */
  capacity: number;
  bookedCount: number;
  gender: Gender | null;
  level: Level | null;
  status: SlotStatus;
  /** Set when generated from an AvailabilityTemplate; null for ad-hoc slots. */
  templateId: AvailabilityTemplateId | null;
  /**
   * When the ADMIN manually confirmed the session (S11.1) — null otherwise. This is
   * ONLY the manual timestamp: a session confirmed by FILLING has this null and is
   * confirmed by derivation (booked_count >= capacity). Manual confirmation is
   * STICKY (survives an un-fill); fill-confirmation is derived. Read confirmed-ness
   * via @tpa/core's isSessionConfirmed, never this field alone.
   */
  manuallyConfirmedAt: IsoInstant | null;
}

/**
 * A player's claim on one seat of a slot, paid for by exactly one CreditBatch.
 * `creditBatchId` records which batch paid, so a refund returns the credit to the
 * right batch — with that batch's original expiry, not a fresh 30 days.
 */
export interface Booking {
  id: BookingId;
  slotId: SlotId;
  playerId: PlayerId;
  creditBatchId: CreditBatchId;
  status: BookingStatus;
  bookedAt: IsoInstant;
  /** Set when status becomes `cancelled`; null otherwise. */
  cancelledAt: IsoInstant | null;
}

/**
 * An in-app notification, minted server-side by tpa.notify inside the event's RPC
 * (S12). RLS lets the owning player read it and write only `read_at`. `slotId` /
 * `bookingId` are the deep-link targets (a session_confirmed row → its session; a
 * credits_granted row carries neither → the wallet). The gateway-internal `pushed_at`
 * column is not surfaced here.
 */
export interface Notification {
  id: NotificationId;
  playerId: PlayerId;
  type: NotificationType;
  slotId: SlotId | null;
  bookingId: BookingId | null;
  title: string;
  body: string;
  createdAt: IsoInstant;
  /** Null while unread; set (by the player) when opened. */
  readAt: IsoInstant | null;
}
