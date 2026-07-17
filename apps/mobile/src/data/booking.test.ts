import { cairoCalendarDate } from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CreditBatch,
  IsoInstant,
  LocalTime,
  Player,
  SessionSlot,
  Weekday,
} from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  bookedSlotIds,
  dateStrip,
  operatingWeekdays,
  pastSessions,
  slotAvailability,
  slotsForType,
  upcomingSessions,
} from './booking';
import { balanceByType } from './wallet';

/**
 * The client-side read derivations that survived S9 — pure functions of the rows
 * the query layer fetches. The two mutation seams (bookSlot / cancelBooking) moved
 * to the DB RPCs and are proven server-side (pgTAP + concurrency + the real-session
 * suite); what remains to cover here is the read logic: availability preview, the
 * upcoming/past split, operating days, and typed balances. Inputs are constructed
 * explicitly (not mined from fixtures) so each case is deterministic — exactly the
 * arrays the hooks feed from live Supabase rows.
 */
const NOW = '2026-03-15T09:00:00.000Z' as IsoInstant;
const iso = (dayOffset: number, hour = 12): IsoInstant =>
  new Date(Date.UTC(2026, 2, 15 + dayOffset, hour)).toISOString() as IsoInstant;

const player: Player = {
  id: 'pl_test' as Player['id'],
  phone: '+201555550001',
  name: 'Omar Test',
  gender: 'men',
  level: 'beginner',
  createdAt: iso(-30),
};

const coach: Coach = {
  id: 'co_1' as Coach['id'],
  name: 'Coach',
  bio: 'b',
  photoUrl: null,
  isActive: true,
};

function slot(over: Partial<SessionSlot> & Pick<SessionSlot, 'id'>): SessionSlot {
  return {
    coachId: coach.id,
    startsAt: iso(2),
    endsAt: iso(2, 13),
    trainingType: 'group',
    capacity: 4,
    bookedCount: 0,
    gender: 'men',
    level: 'beginner',
    status: 'published',
    templateId: null,
    confirmedAt: null,
    ...over,
  };
}

function batch(over: Partial<CreditBatch> & Pick<CreditBatch, 'id'>): CreditBatch {
  return {
    playerId: player.id,
    source: 'purchase',
    purchaseId: null,
    trainingType: 'group',
    quantityTotal: 4,
    quantityRemaining: 4,
    expiresAt: iso(20),
    createdAt: iso(-1),
    note: null,
    ...over,
  };
}

function template(weekday: Weekday, isActive = true): AvailabilityTemplate {
  return {
    id: `at_${weekday}_${isActive ? 'a' : 'i'}` as AvailabilityTemplate['id'],
    coachId: coach.id,
    weekday,
    startTime: '09:00' as LocalTime,
    endTime: '10:00' as LocalTime,
    trainingType: 'trial',
    capacity: 1,
    gender: null,
    level: null,
    isActive,
  };
}

function booking(over: Partial<Booking> & Pick<Booking, 'id' | 'slotId'>): Booking {
  return {
    playerId: player.id,
    creditBatchId: 'cb_1' as Booking['creditBatchId'],
    status: 'booked',
    bookedAt: iso(-1),
    cancelledAt: null,
    ...over,
  };
}

describe('bookedSlotIds', () => {
  it('includes non-cancelled bookings and excludes cancelled ones', () => {
    const ids = bookedSlotIds([
      booking({ id: 'bk_a' as Booking['id'], slotId: 'sl_a' as SessionSlot['id'] }),
      booking({ id: 'bk_b' as Booking['id'], slotId: 'sl_b' as SessionSlot['id'], status: 'cancelled' }),
      booking({ id: 'bk_c' as Booking['id'], slotId: 'sl_c' as SessionSlot['id'], status: 'attended' }),
    ]);
    expect(ids.has('sl_a' as SessionSlot['id'])).toBe(true);
    expect(ids.has('sl_c' as SessionSlot['id'])).toBe(true); // attended still holds the seat
    expect(ids.has('sl_b' as SessionSlot['id'])).toBe(false); // cancelled frees it
  });
});

describe('slotAvailability', () => {
  const usableGroup = batch({ id: 'cb_g' as CreditBatch['id'] });

  it('reports `booked` for a slot the player already holds', () => {
    const s = slot({ id: 'sl_1' as SessionSlot['id'] });
    const bookings = [booking({ id: 'bk_1' as Booking['id'], slotId: s.id })];
    expect(slotAvailability(s, player, [usableGroup], bookings, NOW).kind).toBe('booked');
  });

  it('reports `bookable` for a fresh matching slot with a usable credit', () => {
    const s = slot({ id: 'sl_2' as SessionSlot['id'] });
    const av = slotAvailability(s, player, [usableGroup], [], NOW);
    expect(av.kind).toBe('bookable');
  });

  it('reports `full` when the slot is at capacity', () => {
    const s = slot({ id: 'sl_3' as SessionSlot['id'], capacity: 4, bookedCount: 4 });
    expect(slotAvailability(s, player, [usableGroup], [], NOW).kind).toBe('full');
  });

  it('distinguishes `no_credit` (never had) from `credits_expired` (lapsed)', () => {
    const s = slot({ id: 'sl_4' as SessionSlot['id'] });
    expect(slotAvailability(s, player, [], [], NOW).kind).toBe('no_credit');
    const expired = batch({ id: 'cb_exp' as CreditBatch['id'], expiresAt: iso(-1), quantityRemaining: 2 });
    expect(slotAvailability(s, player, [expired], [], NOW).kind).toBe('credits_expired');
  });

  it('reports `gender_mismatch` for a ladies-only slot', () => {
    const s = slot({ id: 'sl_5' as SessionSlot['id'], gender: 'ladies' });
    expect(slotAvailability(s, player, [usableGroup], [], NOW).kind).toBe('gender_mismatch');
  });
});

describe('slotsForType', () => {
  it('returns only published duo slots on the chosen day, sorted by start', () => {
    const day = cairoCalendarDate(iso(2));
    const slots: SessionSlot[] = [
      slot({ id: 'd2' as SessionSlot['id'], trainingType: 'duo', gender: null, level: null, startsAt: iso(2, 16) }),
      slot({ id: 'd1' as SessionSlot['id'], trainingType: 'duo', gender: null, level: null, startsAt: iso(2, 10) }),
      slot({ id: 'g1' as SessionSlot['id'], trainingType: 'group', startsAt: iso(2, 11) }), // wrong type
      slot({ id: 'd3' as SessionSlot['id'], trainingType: 'duo', gender: null, level: null, startsAt: iso(3, 10) }), // wrong day
      slot({ id: 'dc' as SessionSlot['id'], trainingType: 'duo', gender: null, level: null, status: 'cancelled', startsAt: iso(2, 8) }),
    ];
    const out = slotsForType(slots, 'duo', player, day);
    expect(out.map((s) => s.id)).toEqual(['d1', 'd2']);
  });
});

describe('upcoming / past split', () => {
  it('upcoming = active booking with a future slot; cancelled + past go to past', () => {
    const future = slot({ id: 'f' as SessionSlot['id'], startsAt: iso(3) });
    const past = slot({ id: 'p' as SessionSlot['id'], startsAt: iso(-3) });
    const cancelledFuture = slot({ id: 'cf' as SessionSlot['id'], startsAt: iso(4) });
    const slots = [future, past, cancelledFuture];
    const bookings = [
      booking({ id: 'b_f' as Booking['id'], slotId: future.id }),
      booking({ id: 'b_p' as Booking['id'], slotId: past.id }),
      booking({ id: 'b_cf' as Booking['id'], slotId: cancelledFuture.id, status: 'cancelled' }),
    ];
    const up = upcomingSessions(bookings, slots, [coach], NOW).map((e) => e.booking.id);
    const pastIds = pastSessions(bookings, slots, [coach], NOW).map((e) => e.booking.id);
    expect(up).toEqual(['b_f']);
    expect(pastIds.sort()).toEqual(['b_cf', 'b_p']);
  });
});

describe('operatingWeekdays / dateStrip (from active templates)', () => {
  it('open = weekdays with an active template; inactive or missing template = closed', () => {
    const open = operatingWeekdays([template(1, true), template(3, false)]);
    expect(open.has(1 as Weekday)).toBe(true); // Monday: active template
    expect(open.has(3 as Weekday)).toBe(false); // Wednesday: template exists but INACTIVE
    expect(open.has(2 as Weekday)).toBe(false); // Tuesday: no template at all
  });

  it('a weekday with an active template but ZERO slots is OPEN (nothing available), not CLOSED', () => {
    // Only Monday(1) has an active template. Crucially we pass NO slots anywhere —
    // the regression this guards is "no slots ⇒ every day closed".
    const days = dateStrip([template(1, true)], NOW, 14);
    const mondays = days.filter((d) => d.weekday === 1);
    const tuesdays = days.filter((d) => d.weekday === 2);
    expect(mondays.length).toBeGreaterThan(0);
    expect(tuesdays.length).toBeGreaterThan(0);

    // Monday is OPEN despite zero published slots — the operating day still shows.
    for (const d of mondays) expect(d.closed).toBe(false);
    // Tuesday has no template → genuinely CLOSED.
    for (const d of tuesdays) expect(d.closed).toBe(true);

    // On that open Monday the slot list is simply empty — "open, nothing available",
    // which the Book screen renders as an empty state, NOT a closed day.
    expect(slotsForType([], 'trial', player, mondays[0]!)).toEqual([]);
  });
});

describe('balanceByType', () => {
  it('sums only usable credits, per type', () => {
    const batches = [
      batch({ id: 'g' as CreditBatch['id'], trainingType: 'group', quantityRemaining: 3 }),
      batch({ id: 'd_exp' as CreditBatch['id'], trainingType: 'duo', quantityRemaining: 2, expiresAt: iso(-1) }),
    ];
    const bal = balanceByType(batches, NOW);
    expect(bal.group).toBe(3);
    expect(bal.duo).toBe(0); // expired → not counted
    expect(bal.individual).toBe(0);
  });
});
