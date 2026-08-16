import { BOOKING_WINDOW_HOURS, cairoCalendarDate, cairoWeekStart, templateCoveredWeekdays } from '@tpa/core';
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
  isWithinBookingWindow,
  pastSessions,
  sessionsForDay,
  slotAvailability,
  upcomingSessions,
  weekAvailabilitySummary,
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
    manuallyConfirmedAt: null,
    setByBookingAt: null,
    ...over,
  };
}

/** An OPEN block: untyped, so gender/level are null too until a first booking sets one. */
function openSlot(over: Partial<SessionSlot> & Pick<SessionSlot, 'id'>): SessionSlot {
  return slot({ trainingType: null, gender: null, level: null, ...over });
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
    expect(slotAvailability(s, player, [usableGroup], bookings, NOW, 'group').kind).toBe('booked');
  });

  it('reports `bookable` for a fresh matching slot with a usable credit, naming the resolved type', () => {
    const s = slot({ id: 'sl_2' as SessionSlot['id'] });
    const av = slotAvailability(s, player, [usableGroup], [], NOW, 'group');
    expect(av).toEqual({ kind: 'bookable', creditBatchId: 'cb_g', trainingType: 'group' });
  });

  it('reports `full` when the slot is at capacity', () => {
    const s = slot({ id: 'sl_3' as SessionSlot['id'], capacity: 4, bookedCount: 4 });
    expect(slotAvailability(s, player, [usableGroup], [], NOW, 'group').kind).toBe('full');
  });

  it('distinguishes `no_credit` (never had) from `credits_expired` (lapsed)', () => {
    const s = slot({ id: 'sl_4' as SessionSlot['id'] });
    expect(slotAvailability(s, player, [], [], NOW, 'group').kind).toBe('no_credit');
    const expired = batch({ id: 'cb_exp' as CreditBatch['id'], expiresAt: iso(-1), quantityRemaining: 2 });
    expect(slotAvailability(s, player, [expired], [], NOW, 'group').kind).toBe('credits_expired');
  });

  it('a GENDER mismatch is `bookable`, never a blocking kind — display-only (rule 4, extended by the gender-display-only migration)', () => {
    const s = slot({ id: 'sl_5' as SessionSlot['id'], gender: 'ladies' }); // player is 'men'
    expect(slotAvailability(s, player, [usableGroup], [], NOW, 'group').kind).toBe('bookable');
  });

  it('a LEVEL mismatch is `bookable`, never a blocking kind — display-only (rule 4)', () => {
    const s = slot({ id: 'sl_6' as SessionSlot['id'], level: 'intermediate' }); // player is 'beginner'
    expect(slotAvailability(s, player, [usableGroup], [], NOW, 'group').kind).toBe('bookable');
  });

  it('reports `type_taken` when chosenType disagrees with an already-typed slot (the race outcome)', () => {
    const s = slot({ id: 'sl_7' as SessionSlot['id'], trainingType: 'group' });
    const duoCredit = batch({ id: 'cb_duo' as CreditBatch['id'], trainingType: 'duo' });
    expect(slotAvailability(s, player, [duoCredit], [], NOW, 'duo').kind).toBe('type_taken');
  });

  it('an OPEN slot is `bookable` as any type the player can afford, naming that resolved type', () => {
    const s = openSlot({ id: 'sl_8' as SessionSlot['id'] });
    const duoCredit = batch({ id: 'cb_duo2' as CreditBatch['id'], trainingType: 'duo' });
    expect(slotAvailability(s, player, [duoCredit], [], NOW, 'duo')).toEqual({
      kind: 'bookable',
      creditBatchId: 'cb_duo2',
      trainingType: 'duo',
    });
  });
});

describe('sessionsForDay', () => {
  it('returns every published slot on the chosen day exactly once, sorted by start — typed and open together', () => {
    const day = cairoCalendarDate(iso(2));
    const usableGroup = batch({ id: 'cb_sfd_g' as CreditBatch['id'] });
    const slots: SessionSlot[] = [
      slot({ id: 'd2' as SessionSlot['id'], trainingType: 'group', startsAt: iso(2, 16) }),
      openSlot({ id: 'o1' as SessionSlot['id'], startsAt: iso(2, 10) }),
      slot({ id: 'd3' as SessionSlot['id'], trainingType: 'group', startsAt: iso(3, 10) }), // wrong day
      slot({ id: 'dc' as SessionSlot['id'], trainingType: 'group', status: 'cancelled', startsAt: iso(2, 8) }),
    ];
    const out = sessionsForDay(slots, player, [usableGroup], [], NOW, day);
    expect(out.map((s) => s.slot.id)).toEqual(['o1', 'd2']);
  });

  it('a LEVEL-mismatched group slot is still included, verdict bookable (display-only, never hidden — rule 4)', () => {
    const day = cairoCalendarDate(iso(2));
    const usableGroup = batch({ id: 'cb_sfd_lvl' as CreditBatch['id'] });
    const s = slot({ id: 'g_int' as SessionSlot['id'], trainingType: 'group', level: 'intermediate' });
    const out = sessionsForDay([s], player, [usableGroup], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['g_int']);
    expect(out[0]!.availability.kind).toBe('bookable');
  });

  it('a GENDER-mismatched group slot is bookable — display-only, never hidden or blocked (rule 4, extended)', () => {
    const day = cairoCalendarDate(iso(2));
    const usableGroup = batch({ id: 'cb_sfd_gender' as CreditBatch['id'] });
    const s = slot({ id: 'g_ladies' as SessionSlot['id'], trainingType: 'group', gender: 'ladies' });
    const out = sessionsForDay([s], player, [usableGroup], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['g_ladies']);
    expect(out[0]!.availability.kind).toBe('bookable');
  });

  it('credits never hide a session: an unaffordable slot still appears, verdict `no_credit`', () => {
    const day = cairoCalendarDate(iso(2));
    const s = slot({ id: 'g_nocredit' as SessionSlot['id'] });
    const out = sessionsForDay([s], player, [], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['g_nocredit']);
    expect(out[0]!.availability.kind).toBe('no_credit');
  });

  it('an OPEN block is bookable as whichever type it resolves to per bookableTypesFor', () => {
    const day = cairoCalendarDate(iso(2));
    const open = openSlot({ id: 'open_1' as SessionSlot['id'] });
    const duoCredit = batch({ id: 'cb_o_duo' as CreditBatch['id'], trainingType: 'duo' });
    const out = sessionsForDay([open], player, [duoCredit], [], NOW, day);
    expect(out).toEqual([
      { slot: open, availability: { kind: 'bookable', creditBatchId: 'cb_o_duo', trainingType: 'duo' } },
    ]);
  });

  it('an OPEN block with zero usable credits still appears, verdict `no_credit`', () => {
    const day = cairoCalendarDate(iso(2));
    const open = openSlot({ id: 'open_2' as SessionSlot['id'] });
    const out = sessionsForDay([open], player, [], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['open_2']);
    expect(out[0]!.availability.kind).toBe('no_credit');
  });

  it('an OPEN block at capacity appears, verdict `full` (structural check, not a credit gap)', () => {
    const day = cairoCalendarDate(iso(2));
    const open = openSlot({ id: 'open_full' as SessionSlot['id'], capacity: 2, bookedCount: 2 });
    const out = sessionsForDay([open], player, [], [], NOW, day);
    expect(out[0]!.availability.kind).toBe('full');
  });

  it('a slot the player already booked appears, verdict `booked`, regardless of type', () => {
    const day = cairoCalendarDate(iso(2));
    const open = openSlot({ id: 'open_booked' as SessionSlot['id'] });
    const bookings = [booking({ id: 'bk_sfd' as Booking['id'], slotId: open.id })];
    const out = sessionsForDay([open], player, [], bookings, NOW, day);
    expect(out[0]!.availability.kind).toBe('booked');
  });
});

describe('isWithinBookingWindow (Session 2 — the 5h-empty-slot hide, mirrors the server booking_window_closed guard)', () => {
  const hoursFromNow = (h: number): IsoInstant =>
    new Date(new Date(NOW).getTime() + h * 3_600_000).toISOString() as IsoInstant;

  it('is true for an EMPTY slot inside the window', () => {
    const s = slot({ id: 'bw1' as SessionSlot['id'], bookedCount: 0, startsAt: hoursFromNow(4) });
    expect(isWithinBookingWindow(s, NOW)).toBe(true);
  });

  it('is false at exactly the window boundary and beyond — matches the server\'s ">=" (inclusive-allow)', () => {
    const atBoundary = slot({
      id: 'bw2' as SessionSlot['id'],
      bookedCount: 0,
      startsAt: hoursFromNow(BOOKING_WINDOW_HOURS),
    });
    const beyond = slot({
      id: 'bw3' as SessionSlot['id'],
      bookedCount: 0,
      startsAt: hoursFromNow(BOOKING_WINDOW_HOURS + 1),
    });
    expect(isWithinBookingWindow(atBoundary, NOW)).toBe(false);
    expect(isWithinBookingWindow(beyond, NOW)).toBe(false);
  });

  it('is false once the slot has at least one booking, however soon it starts', () => {
    const s = slot({ id: 'bw4' as SessionSlot['id'], bookedCount: 1, startsAt: hoursFromNow(1) });
    expect(isWithinBookingWindow(s, NOW)).toBe(false);
  });

  it('is false for an already-started empty slot — this is about the future, not the separate "past" verdict', () => {
    const s = slot({ id: 'bw5' as SessionSlot['id'], bookedCount: 0, startsAt: hoursFromNow(-1) });
    expect(isWithinBookingWindow(s, NOW)).toBe(false);
  });
});

describe('sessionsForDay hides empty-within-window slots entirely (not dimmed)', () => {
  const hoursFromNow = (h: number): IsoInstant =>
    new Date(new Date(NOW).getTime() + h * 3_600_000).toISOString() as IsoInstant;

  it('an empty slot inside the window is absent from the feed entirely — not shown dimmed', () => {
    const startsAt = hoursFromNow(4);
    const day = cairoCalendarDate(startsAt);
    const s = slot({ id: 'sfd_bw1' as SessionSlot['id'], bookedCount: 0, startsAt });
    expect(sessionsForDay([s], player, [], [], NOW, day)).toEqual([]);
  });

  it('the SAME empty slot at 6h+ out is included normally', () => {
    const startsAt = hoursFromNow(6);
    const day = cairoCalendarDate(startsAt);
    const s = slot({ id: 'sfd_bw2' as SessionSlot['id'], bookedCount: 0, startsAt });
    const out = sessionsForDay([s], player, [], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['sfd_bw2']);
  });

  it('a slot with an existing booking is still shown even deep inside the window', () => {
    const startsAt = hoursFromNow(1);
    const day = cairoCalendarDate(startsAt);
    const s = slot({ id: 'sfd_bw3' as SessionSlot['id'], bookedCount: 1, startsAt });
    const out = sessionsForDay([s], player, [], [], NOW, day);
    expect(out.map((x) => x.slot.id)).toEqual(['sfd_bw3']);
  });

  it('an empty OPEN (untyped) block inside the window is hidden exactly like a typed one', () => {
    const startsAt = hoursFromNow(4);
    const day = cairoCalendarDate(startsAt);
    const open = openSlot({ id: 'sfd_bw4' as SessionSlot['id'], bookedCount: 0, startsAt });
    expect(sessionsForDay([open], player, [], [], NOW, day)).toEqual([]);
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

describe('templateCoveredWeekdays / dateStrip (@tpa/core isDayOpen)', () => {
  it('open = weekdays with an active template; inactive or missing template = closed', () => {
    const open = templateCoveredWeekdays([template(1, true), template(3, false)]);
    expect(open.has(1 as Weekday)).toBe(true); // Monday: active template
    expect(open.has(3 as Weekday)).toBe(false); // Wednesday: template exists but INACTIVE
    expect(open.has(2 as Weekday)).toBe(false); // Tuesday: no template at all
  });

  it('a weekday with an active template but ZERO slots is OPEN (nothing available), not CLOSED', () => {
    // Only Monday(1) has an active template. Crucially we pass NO slots anywhere —
    // the regression this guards is "no slots ⇒ every day closed".
    const days = dateStrip([template(1, true)], [], NOW, 14);
    const mondays = days.filter((d) => d.weekday === 1);
    const tuesdays = days.filter((d) => d.weekday === 2);
    expect(mondays.length).toBeGreaterThan(0);
    expect(tuesdays.length).toBeGreaterThan(0);

    // Monday is OPEN despite zero published slots — the operating day still shows.
    for (const d of mondays) expect(d.closed).toBe(false);
    // ...but with zero spots, since there's nothing published yet.
    for (const d of mondays) expect(d.spots).toBe(0);
    // Tuesday has no template → genuinely CLOSED (and so 0 spots too).
    for (const d of tuesdays) {
      expect(d.closed).toBe(true);
      expect(d.spots).toBe(0);
    }

    // On that open Monday the slot list is simply empty — "open, nothing available",
    // which the Book screen renders as an empty state, NOT a closed day.
    expect(sessionsForDay([], player, [], [], NOW, mondays[0]!)).toEqual([]);
  });

  it('a published one-off slot opens ONLY its own date on an otherwise template-uncovered weekday', () => {
    // No templates at all — every weekday is template-uncovered.
    const tuesdays = dateStrip([], [], NOW, 14).filter((d) => d.weekday === 2);
    expect(tuesdays.length).toBeGreaterThanOrEqual(2);
    const [firstTuesday, secondTuesday] = tuesdays;

    const oneOff = openSlot({
      id: 'sl_oneoff' as SessionSlot['id'],
      startsAt: `${firstTuesday!.year}-${String(firstTuesday!.month).padStart(2, '0')}-${String(firstTuesday!.day).padStart(2, '0')}T12:00:00.000Z` as IsoInstant,
      endsAt: `${firstTuesday!.year}-${String(firstTuesday!.month).padStart(2, '0')}-${String(firstTuesday!.day).padStart(2, '0')}T13:00:00.000Z` as IsoInstant,
    });
    const days = dateStrip([], [oneOff], NOW, 14);
    const openedTuesday = days.find((d) => d.key === firstTuesday!.key)!;
    const laterTuesday = days.find((d) => d.key === secondTuesday!.key)!;
    expect(openedTuesday.closed).toBe(false); // that specific date is opened by the one-off
    expect(laterTuesday.closed).toBe(true); // the following Tuesday is untouched
  });

  it('a cancelled-only one-off does NOT open its day', () => {
    const tuesday = dateStrip([], [], NOW, 14).find((d) => d.weekday === 2)!;
    const cancelledOneOff = openSlot({
      id: 'sl_cancelled_oneoff' as SessionSlot['id'],
      status: 'cancelled',
      startsAt: `${tuesday.year}-${String(tuesday.month).padStart(2, '0')}-${String(tuesday.day).padStart(2, '0')}T12:00:00.000Z` as IsoInstant,
      endsAt: `${tuesday.year}-${String(tuesday.month).padStart(2, '0')}-${String(tuesday.day).padStart(2, '0')}T13:00:00.000Z` as IsoInstant,
    });
    const days = dateStrip([], [cancelledOneOff], NOW, 14);
    expect(days.find((d) => d.key === tuesday.key)!.closed).toBe(true);
  });

  it('spots sums remaining capacity across the day, excluding full, past-within-day, cancelled, AND empty-within-the-booking-window slots — gender never excludes', () => {
    const testNow = iso(2, 14); // 2pm on day+2 — late enough in the day to have a genuine "already started" case
    const day = cairoCalendarDate(testNow);
    const slots: SessionSlot[] = [
      slot({ id: 'sp1' as SessionSlot['id'], capacity: 4, bookedCount: 1, startsAt: iso(2, 16) }), // +2h, ALREADY has a booking — the booking-window rule never applies to it, at any hour
      slot({ id: 'sp2' as SessionSlot['id'], capacity: 2, bookedCount: 0, startsAt: iso(2, 21) }), // +7h, empty but OUTSIDE the 5h window — counts
      slot({ id: 'sp_ladies' as SessionSlot['id'], gender: 'ladies', capacity: 4, startsAt: iso(2, 20) }), // +6h, empty, outside the window — gender no longer excludes (gender-display-only migration), even for this (men) player
      slot({ id: 'sp_window' as SessionSlot['id'], capacity: 4, startsAt: iso(2, 17) }), // excluded: EMPTY and only +3h out — inside the 5h booking window (Session 2)
      slot({ id: 'sp_full' as SessionSlot['id'], capacity: 2, bookedCount: 2, startsAt: iso(2, 19) }), // excluded: full
      slot({ id: 'sp_past' as SessionSlot['id'], capacity: 4, startsAt: iso(2, 10) }), // excluded: already started (10am < 2pm testNow, same day)
      slot({ id: 'sp_cancelled' as SessionSlot['id'], capacity: 4, status: 'cancelled', startsAt: iso(2, 20) }), // excluded: cancelled
      slot({ id: 'sp_wrong_day' as SessionSlot['id'], capacity: 4, startsAt: iso(3, 10) }), // excluded: different day
    ];
    const templates = [template(day.weekday, true)];
    const days = dateStrip(templates, slots, testNow, 14);
    expect(days.find((d) => d.key === `${day.year}-${day.month}-${day.day}`)!.spots).toBe(9);
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

describe('weekAvailabilitySummary', () => {
  const nowMs = new Date(NOW).getTime();
  const soon = (hoursFromNow: number): IsoInstant =>
    new Date(nowMs + hoursFromNow * 3_600_000).toISOString() as IsoInstant;
  const weekEndMs = new Date(cairoWeekStart(NOW)).getTime() + 7 * 86_400_000;
  const afterThisWeek = (hoursPast: number): IsoInstant =>
    new Date(weekEndMs + hoursPast * 3_600_000).toISOString() as IsoInstant;

  it('counts joinable sessions in the rest of this week, today, and finds the very next one', () => {
    // bookedCount: 1 — soon(2) is inside the 5h booking window; an ALREADY-booked
    // slot is exempt from that rule (Session 2), which is what this test needs to
    // isolate: it's testing the week/today/next-session counting, not the window rule.
    const laterToday = slot({ id: 'w1' as SessionSlot['id'], bookedCount: 1, startsAt: soon(2) });
    const laterThisWeek = slot({ id: 'w2' as SessionSlot['id'], startsAt: afterThisWeek(-1) }); // 1h before week end
    const nextWeek = slot({ id: 'w3' as SessionSlot['id'], startsAt: afterThisWeek(1) }); // 1h after week end
    const summary = weekAvailabilitySummary([laterToday, laterThisWeek, nextWeek], NOW);
    expect(summary.sessionsThisWeek).toBe(2); // w1 + w2, not w3
    expect(summary.sessionsToday).toBe(1); // w1 only
    expect(summary.nextSessionAt).toBe(soon(2)); // the soonest overall, not just this week
  });

  it('no longer excludes a gender-mismatched slot — gender never gates anymore (gender-display-only migration)', () => {
    // bookedCount: 1 so this isolates the gender question from the (separate) booking-window rule.
    const ladiesSlot = slot({ id: 'w_ladies' as SessionSlot['id'], gender: 'ladies', bookedCount: 1, startsAt: soon(2) });
    const summary = weekAvailabilitySummary([ladiesSlot], NOW);
    expect(summary.sessionsThisWeek).toBe(1);
    expect(summary.nextSessionAt).toBe(soon(2));
  });

  it('excludes full, past and cancelled slots, but NOT a slot the player merely lacks credit for', () => {
    const full = slot({ id: 'w_full' as SessionSlot['id'], capacity: 2, bookedCount: 2, startsAt: soon(2) });
    const past = slot({ id: 'w_past' as SessionSlot['id'], startsAt: iso(-1) });
    const cancelled = slot({ id: 'w_cancelled' as SessionSlot['id'], status: 'cancelled', startsAt: soon(2) });
    // bookedCount: 1 so this isolates the credit question from the (separate) booking-window rule.
    const noCredit = slot({ id: 'w_nocredit' as SessionSlot['id'], bookedCount: 1, startsAt: soon(2) });
    // No batches passed at all — noCredit has zero usable credit but still counts:
    // "credits never hide a session" applies to this coarse count too.
    const summary = weekAvailabilitySummary([full, past, cancelled, noCredit], NOW);
    expect(summary.sessionsThisWeek).toBe(1);
    expect(summary.nextSessionAt).toBe(soon(2));
  });

  it('reports zero and a null next session when nothing at all is upcoming', () => {
    const summary = weekAvailabilitySummary([], NOW);
    expect(summary).toEqual({ sessionsThisWeek: 0, sessionsToday: 0, nextSessionAt: null });
  });

  it('excludes an empty slot inside the 5h booking window (Session 2) — an EMPTY soon(2) slot does not count, but the same slot WITH a booking does', () => {
    const emptyAndSoon = slot({ id: 'w_bw_empty' as SessionSlot['id'], bookedCount: 0, startsAt: soon(2) });
    const bookedAndSoon = slot({ id: 'w_bw_booked' as SessionSlot['id'], bookedCount: 1, startsAt: soon(3) });
    const onlyEmpty = weekAvailabilitySummary([emptyAndSoon], NOW);
    expect(onlyEmpty).toEqual({ sessionsThisWeek: 0, sessionsToday: 0, nextSessionAt: null });
    const withBooked = weekAvailabilitySummary([emptyAndSoon, bookedAndSoon], NOW);
    expect(withBooked.sessionsThisWeek).toBe(1);
    expect(withBooked.nextSessionAt).toBe(soon(3)); // the empty one is invisible, so the booked one is "next"
  });
});

