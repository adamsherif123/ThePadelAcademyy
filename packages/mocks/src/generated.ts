import { CREDIT_EXPIRY_DAYS } from '@tpa/core';
import type {
  Booking,
  BookingId,
  BookingStatus,
  CreditBatch,
  CreditBatchId,
  Level,
  Package,
  Player,
  PlayerId,
  Purchase,
  PurchaseId,
  SessionSlot,
} from '@tpa/types';

import { mockPackages } from './catalog';
import { MOCK_NOW } from './now';
import { mockSlots } from './schedule';

/**
 * DETERMINISTIC academy-scale fixtures, generated once at import from a fixed
 * seed — no Math.random and no wall-clock reads, so every run produces the exact
 * same data (or the tests would lie). These are APPENDED after the hand-tuned
 * fixtures (pl_omar & friends), never mixed into them: all ids here are namespaced
 * `_g` and reference only real packages/slots, so the client app's 66 tests —
 * which key off pl_omar and the fixed batch/booking relationships — are untouched.
 *
 * Scale: ~96 extra players, ~4 months of seasonal purchase history (so the 8-week
 * revenue chart has a real shape), the purchase-backed credit batches those
 * generate, and bookings/attendance spread across slots. Enough to judge the
 * dashboard the way the owner will.
 */

// --- Seeded PRNG (mulberry32): pure, integer-stable, no globals. ---
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x54_50_41_62); // "TPAb"
const rand = () => rng();
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
/** Weighted pick: items paired with integer weights. */
function weighted<T>(items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

const NOW_MS = new Date(MOCK_NOW).getTime();
const DAY_MS = 86_400_000;
/** An instant `daysAgo` days before MOCK_NOW at ~midday Cairo (safe from month/week edges). */
const instantDaysAgo = (daysAgo: number, hourOffset = 0): string =>
  new Date(NOW_MS - daysAgo * DAY_MS + hourOffset * 3_600_000).toISOString();

// --- Names (deterministic pools) ---
const MEN_FIRST = [
  'Ahmed', 'Mohamed', 'Mahmoud', 'Khaled', 'Youssef', 'Omar', 'Ali', 'Hassan', 'Amr', 'Karim',
  'Tarek', 'Sherif', 'Hesham', 'Adham', 'Ziad', 'Marwan', 'Seif', 'Ramy', 'Nader', 'Fady',
];
const LADIES_FIRST = [
  'Nour', 'Salma', 'Dina', 'Hana', 'Mariam', 'Rana', 'Yasmin', 'Farida', 'Habiba', 'Layla',
  'Menna', 'Aya', 'Nada', 'Sara', 'Malak', 'Jana', 'Rowan', 'Lina', 'Nourhan', 'Dalia',
];
const LAST = [
  'Nagy', 'Sobhy', 'Ibrahim', 'Halim', 'Fahmy', 'Kamel', 'Lotfy', 'Fouad', 'Adel', 'Zaki',
  'Rashad', 'El-Masry', 'Hassan', 'Mostafa', 'Sabry', 'Farouk', 'Nasser', 'Gamal', 'Shaker', 'Ezzat',
];

const LEVELS: readonly (readonly [Level, number])[] = [
  ['beginner', 5],
  ['adv_beginner', 3],
  ['intermediate', 2],
];

// --- Players (~96) ---
const PLAYER_COUNT = 96;
export const generatedPlayers: Player[] = Array.from({ length: PLAYER_COUNT }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  const gender = weighted([['men', 55] as const, ['ladies', 45] as const]);
  const first = pick(gender === 'men' ? MEN_FIRST : LADIES_FIRST);
  const last = pick(LAST);
  return {
    id: `pl_g${n}` as PlayerId,
    phone: `+20105${String(1000000 + i * 7919).slice(-7)}`,
    name: `${first} ${last}`,
    gender,
    level: weighted(LEVELS),
    createdAt: instantDaysAgo(randInt(1, 200)) as Player['createdAt'],
  };
});

// --- Purchases: ~4 months, seasonal weekly volume so the chart isn't flat ---
const WINDOW_DAYS = 133; // 19 weeks
// Index = weeks-ago (0 = current, partial). A June hump, a July decline, lower history.
const WEEK_WEIGHT = [
  0.45, 0.8, 0.7, 0.95, 0.75, 1.0, 0.85, 0.5, 0.55, 0.5, 0.45, 0.45, 0.4, 0.4, 0.35, 0.35, 0.3,
  0.3, 0.25,
];
const DAILY_BASE = 3;
// Group sells most; 4-packs most common within a type.
const PACKAGE_WEIGHTS: readonly (readonly [Package, number])[] = mockPackages.map((p) => {
  const typeW = p.trainingType === 'group' ? 5 : p.trainingType === 'duo' ? 3 : 2;
  const sizeW = p.sessionCount === 4 ? 5 : p.sessionCount === 8 ? 3 : 2;
  return [p, typeW * sizeW] as const;
});
const PURCHASE_STATUS: readonly (readonly [Purchase['status'], number])[] = [
  ['succeeded', 92],
  ['pending', 4],
  ['failed', 4],
];

export const generatedPurchases: Purchase[] = [];
export const generatedBatches: CreditBatch[] = [];
let purchaseSeq = 0;
let batchSeq = 0;
/** player id -> their purchase-backed batch ids (for booking references). */
const batchesByPlayer = new Map<string, CreditBatchId[]>();

for (let dayOffset = WINDOW_DAYS; dayOffset >= 1; dayOffset -= 1) {
  const weeksAgo = Math.floor((dayOffset - 1) / 7);
  const weight = WEEK_WEIGHT[Math.min(weeksAgo, WEEK_WEIGHT.length - 1)]!;
  const count = Math.round(DAILY_BASE * weight * (0.7 + rand() * 0.6));
  for (let k = 0; k < count; k += 1) {
    const player = pick(generatedPlayers);
    const pkg = weighted(PACKAGE_WEIGHTS);
    const status = weighted(PURCHASE_STATUS);
    const createdAt = instantDaysAgo(dayOffset, randInt(0, 9)) as Purchase['createdAt'];
    const pn = String(++purchaseSeq).padStart(4, '0');
    const purchaseId = `pu_g${pn}` as PurchaseId;
    generatedPurchases.push({
      id: purchaseId,
      playerId: player.id,
      packageId: pkg.id,
      status,
      amount: pkg.price,
      createdAt,
      gatewayOrderId: `pmob_g${pn}`,
      gatewayTransactionId: status === 'succeeded' ? `ptxn_g${pn}` : null,
    });
    if (status !== 'succeeded') continue;
    // A succeeded purchase grants a credit batch (30-day expiry from purchase).
    const remaining = randInt(0, pkg.sessionCount); // 0 = fully used, some partial/full
    const bn = String(++batchSeq).padStart(4, '0');
    const batchId = `cb_g${bn}` as CreditBatchId;
    const expiresAt = new Date(
      new Date(createdAt).getTime() + CREDIT_EXPIRY_DAYS * DAY_MS,
    ).toISOString() as CreditBatch['expiresAt'];
    generatedBatches.push({
      id: batchId,
      playerId: player.id,
      source: 'purchase',
      purchaseId,
      trainingType: pkg.trainingType,
      quantityTotal: pkg.sessionCount,
      quantityRemaining: remaining,
      createdAt,
      expiresAt,
    });
    const list = batchesByPlayer.get(player.id) ?? [];
    list.push(batchId);
    batchesByPlayer.set(player.id, list);
  }
}

// --- Bookings: spread generated players across real slots, with attendance ---
const publishedSlots = mockSlots.filter((s) => s.status === 'published');
const pastSlots = publishedSlots.filter((s) => new Date(s.startsAt).getTime() < NOW_MS);
const futureSlots = publishedSlots.filter((s) => new Date(s.startsAt).getTime() > NOW_MS);
const PAST_STATUS: readonly (readonly [BookingStatus, number])[] = [
  ['attended', 6],
  ['no_show', 2],
  ['cancelled', 2],
];

export const generatedBookings: Booking[] = [];
let bookingSeq = 0;
function addBooking(playerId: PlayerId, slot: SessionSlot, status: BookingStatus): void {
  const batchId = batchesByPlayer.get(playerId)?.[0];
  if (!batchId) return; // only players with a purchased batch get bookings (valid credit ref)
  const bn = String(++bookingSeq).padStart(4, '0');
  generatedBookings.push({
    id: `bk_g${bn}` as BookingId,
    slotId: slot.id,
    playerId,
    creditBatchId: batchId,
    status,
    bookedAt: instantDaysAgo(randInt(2, 20)) as Booking['bookedAt'],
    cancelledAt: status === 'cancelled' ? (instantDaysAgo(randInt(1, 2)) as Booking['cancelledAt']) : null,
  });
}

for (const player of generatedPlayers) {
  if (!batchesByPlayer.has(player.id)) continue;
  const n = randInt(0, 3);
  for (let k = 0; k < n; k += 1) {
    if (futureSlots.length > 0 && rand() < 0.4) {
      addBooking(player.id, pick(futureSlots), 'booked');
    } else if (pastSlots.length > 0) {
      addBooking(player.id, pick(pastSlots), weighted(PAST_STATUS));
    }
  }
}
