import { cairoCalendarDate, cairoWeekStart, templateCoveredWeekdays } from '@tpa/core';
import type {
  AvailabilityTemplate,
  Booking,
  Coach,
  CreditBatch,
  IsoInstant,
  LocalTime,
  Player,
  SessionSlot,
  TrainingType,
  Weekday,
} from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  bestMatch,
  bookedSlotIds,
  dateStrip,
  pastSessions,
  sessionsForDay,
  slotAvailability,
  upcomingSessions,
  weekAvailabilitySummary,
  type DaySession,
  type SlotAvailability,
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

  it('spots sums remaining capacity across the day, excluding only full, past-within-day and cancelled slots — gender never excludes', () => {
    const testNow = iso(2, 14); // 2pm on day+2 — late enough in the day to have a genuine "already started" case
    const day = cairoCalendarDate(testNow);
    const slots: SessionSlot[] = [
      slot({ id: 'sp1' as SessionSlot['id'], capacity: 4, bookedCount: 1, startsAt: iso(2, 16) }), // +3, later today
      slot({ id: 'sp2' as SessionSlot['id'], capacity: 2, bookedCount: 0, startsAt: iso(2, 18) }), // +2, later today
      slot({ id: 'sp_ladies' as SessionSlot['id'], gender: 'ladies', capacity: 4, startsAt: iso(2, 17) }), // +4 — gender no longer excludes (gender-display-only migration), even for this (men) player
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
    const laterToday = slot({ id: 'w1' as SessionSlot['id'], startsAt: soon(2) });
    const laterThisWeek = slot({ id: 'w2' as SessionSlot['id'], startsAt: afterThisWeek(-1) }); // 1h before week end
    const nextWeek = slot({ id: 'w3' as SessionSlot['id'], startsAt: afterThisWeek(1) }); // 1h after week end
    const summary = weekAvailabilitySummary([laterToday, laterThisWeek, nextWeek], NOW);
    expect(summary.sessionsThisWeek).toBe(2); // w1 + w2, not w3
    expect(summary.sessionsToday).toBe(1); // w1 only
    expect(summary.nextSessionAt).toBe(soon(2)); // the soonest overall, not just this week
  });

  it('no longer excludes a gender-mismatched slot — gender never gates anymore (gender-display-only migration)', () => {
    const ladiesSlot = slot({ id: 'w_ladies' as SessionSlot['id'], gender: 'ladies', startsAt: soon(2) });
    const summary = weekAvailabilitySummary([ladiesSlot], NOW);
    expect(summary.sessionsThisWeek).toBe(1);
    expect(summary.nextSessionAt).toBe(soon(2));
  });

  it('excludes full, past and cancelled slots, but NOT a slot the player merely lacks credit for', () => {
    const full = slot({ id: 'w_full' as SessionSlot['id'], capacity: 2, bookedCount: 2, startsAt: soon(2) });
    const past = slot({ id: 'w_past' as SessionSlot['id'], startsAt: iso(-1) });
    const cancelled = slot({ id: 'w_cancelled' as SessionSlot['id'], status: 'cancelled', startsAt: soon(2) });
    const noCredit = slot({ id: 'w_nocredit' as SessionSlot['id'], startsAt: soon(2) });
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
});

describe('bestMatch', () => {
  const bookableAv = (trainingType: TrainingType, creditBatchId = 'cb_bm'): SlotAvailability => ({
    kind: 'bookable',
    creditBatchId: creditBatchId as CreditBatch['id'],
    trainingType,
  });

  it('ranks fewest remaining spots first — the session closest to filling', () => {
    const nearlyFull = slot({ id: 'bm_near' as SessionSlot['id'], capacity: 4, bookedCount: 3 }); // 1 left
    const wideOpen = slot({ id: 'bm_wide' as SessionSlot['id'], capacity: 4, bookedCount: 0 }); // 4 left
    const day: DaySession[] = [
      { slot: wideOpen, availability: bookableAv('group') },
      { slot: nearlyFull, availability: bookableAv('group') },
    ];
    expect(bestMatch(day, player)?.slot.id).toBe('bm_near');
  });

  it('breaks a fill-proximity tie on level match — group sessions only (player is beginner)', () => {
    const matching = slot({ id: 'bm_match' as SessionSlot['id'], level: 'beginner', capacity: 4, bookedCount: 2 });
    const mismatched = slot({
      id: 'bm_mismatch' as SessionSlot['id'],
      level: 'intermediate',
      capacity: 4,
      bookedCount: 2,
    });
    const day: DaySession[] = [
      { slot: mismatched, availability: bookableAv('group') },
      { slot: matching, availability: bookableAv('group') },
    ];
    expect(bestMatch(day, player)?.slot.id).toBe('bm_match');
  });

  it('breaks a fill-proximity + level tie on soonest start time', () => {
    const later = slot({
      id: 'bm_later' as SessionSlot['id'],
      capacity: 4,
      bookedCount: 2,
      startsAt: iso(3, 18),
    });
    const sooner = slot({
      id: 'bm_sooner' as SessionSlot['id'],
      capacity: 4,
      bookedCount: 2,
      startsAt: iso(3, 10),
    });
    const day: DaySession[] = [
      { slot: later, availability: bookableAv('duo') },
      { slot: sooner, availability: bookableAv('duo') },
    ];
    expect(bestMatch(day, player)?.slot.id).toBe('bm_sooner');
  });

  it('breaks a complete tie deterministically by id', () => {
    const a = slot({ id: 'bm_a' as SessionSlot['id'], capacity: 4, bookedCount: 2, startsAt: iso(3, 10) });
    const b = slot({ id: 'bm_b' as SessionSlot['id'], capacity: 4, bookedCount: 2, startsAt: iso(3, 10) });
    const day: DaySession[] = [
      { slot: b, availability: bookableAv('duo') },
      { slot: a, availability: bookableAv('duo') },
    ];
    expect(bestMatch(day, player)?.slot.id).toBe('bm_a');
  });

  it('never surfaces a non-bookable session — skips full/no_credit for the best actually-bookable one', () => {
    const full: DaySession = { slot: slot({ id: 'bm_full' as SessionSlot['id'] }), availability: { kind: 'full' } };
    const noCredit: DaySession = {
      slot: slot({ id: 'bm_nocredit' as SessionSlot['id'] }),
      availability: { kind: 'no_credit' },
    };
    const bookable: DaySession = { slot: slot({ id: 'bm_ok' as SessionSlot['id'] }), availability: bookableAv('group') };
    expect(bestMatch([full, noCredit, bookable], player)?.slot.id).toBe('bm_ok');
  });

  it('returns null when nothing that day is bookable — the caller omits the card entirely', () => {
    const day: DaySession[] = [{ slot: slot({ id: 'bm_full2' as SessionSlot['id'] }), availability: { kind: 'full' } }];
    expect(bestMatch(day, player)).toBeNull();
  });
});
