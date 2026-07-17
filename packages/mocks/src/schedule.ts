import { cairoCalendarDate, materializeTemplateSlot } from '@tpa/core';
import type {
  AvailabilityTemplate,
  AvailabilityTemplateId,
  CoachId,
  LocalTime,
  SessionSlot,
  SlotId,
  SlotStatus,
} from '@tpa/types';

import { MOCK_NOW, hoursFromNow } from './now';

/**
 * Weekly availability rules in Cairo local time. Operating window is Sun–Wed
 * (weekday 0–3), 5–11 PM; group training runs mainly 5–9 PM. gender/level are set
 * for group templates only (per the domain invariant); null otherwise.
 */
export const mockTemplates: AvailabilityTemplate[] = [
  { id: 'at_grp_men_beg_sun' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 0, startTime: '17:00' as LocalTime, endTime: '18:30' as LocalTime, trainingType: 'group', capacity: 4, gender: 'men', level: 'beginner', isActive: true },
  { id: 'at_grp_men_int_sun' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 0, startTime: '18:30' as LocalTime, endTime: '20:00' as LocalTime, trainingType: 'group', capacity: 4, gender: 'men', level: 'intermediate', isActive: true },
  { id: 'at_grp_lad_beg_mon' as AvailabilityTemplateId, coachId: 'co_mariam' as CoachId, weekday: 1, startTime: '17:00' as LocalTime, endTime: '18:30' as LocalTime, trainingType: 'group', capacity: 4, gender: 'ladies', level: 'beginner', isActive: true },
  { id: 'at_grp_men_beg_tue' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 2, startTime: '17:00' as LocalTime, endTime: '18:30' as LocalTime, trainingType: 'group', capacity: 4, gender: 'men', level: 'beginner', isActive: true },
  { id: 'at_grp_lad_int_wed' as AvailabilityTemplateId, coachId: 'co_mariam' as CoachId, weekday: 3, startTime: '17:00' as LocalTime, endTime: '18:30' as LocalTime, trainingType: 'group', capacity: 4, gender: 'ladies', level: 'intermediate', isActive: true },
  // Men's beginner group on Wednesdays too, so the current player has group slots
  // on the default (today) day of the Book screen — one full, one bookable.
  { id: 'at_grp_men_beg_wed_a' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 3, startTime: '17:00' as LocalTime, endTime: '18:30' as LocalTime, trainingType: 'group', capacity: 4, gender: 'men', level: 'beginner', isActive: true },
  { id: 'at_grp_men_beg_wed_b' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 3, startTime: '18:30' as LocalTime, endTime: '20:00' as LocalTime, trainingType: 'group', capacity: 4, gender: 'men', level: 'beginner', isActive: true },
  { id: 'at_duo_tue' as AvailabilityTemplateId, coachId: 'co_karim' as CoachId, weekday: 2, startTime: '20:00' as LocalTime, endTime: '21:00' as LocalTime, trainingType: 'duo', capacity: 2, gender: null, level: null, isActive: true },
  { id: 'at_indiv_wed' as AvailabilityTemplateId, coachId: 'co_karim' as CoachId, weekday: 3, startTime: '21:00' as LocalTime, endTime: '22:00' as LocalTime, trainingType: 'individual', capacity: 1, gender: null, level: null, isActive: true },
  // Trial slots on two evenings so the free signup-trial credits are actually
  // spendable (trial credits with nowhere to go would be a dead fixture).
  { id: 'at_trial_sun' as AvailabilityTemplateId, coachId: 'co_hany' as CoachId, weekday: 0, startTime: '21:00' as LocalTime, endTime: '22:00' as LocalTime, trainingType: 'trial', capacity: 1, gender: null, level: null, isActive: true },
  { id: 'at_trial_wed' as AvailabilityTemplateId, coachId: 'co_mariam' as CoachId, weekday: 3, startTime: '20:00' as LocalTime, endTime: '21:00' as LocalTime, trainingType: 'trial', capacity: 1, gender: null, level: null, isActive: true },
  // A PAUSED rule for the on-leave coach (co_laila): it generates nothing while
  // paused, but the admin can resume it when she's back. Gives the templates tab a
  // Paused badge + an on-leave coach card to render, and proves inactive templates
  // are skipped by generation.
  { id: 'at_grp_lad_beg_tue' as AvailabilityTemplateId, coachId: 'co_laila' as CoachId, weekday: 2, startTime: '18:30' as LocalTime, endTime: '20:00' as LocalTime, trainingType: 'group', capacity: 4, gender: 'ladies', level: 'beginner', isActive: false },
];

// Start a few days before MOCK_NOW so there are past sessions for attended/
// no-show booking history; the future portion still covers the next ~2 weeks.
const WINDOW_START_OFFSET_DAYS = -3;
const WINDOW_DAYS = 17;

/** Calendar dates (Cairo) spanning the fixture window around MOCK_NOW. */
function windowDates(): { year: number; month: number; day: number; weekday: number }[] {
  const anchor = new Date(new Date(MOCK_NOW).getTime() + WINDOW_START_OFFSET_DAYS * 86_400_000);
  const start = cairoCalendarDate(anchor.toISOString() as typeof MOCK_NOW);
  const base = Date.UTC(start.year, start.month - 1, start.day);
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = new Date(base + i * 86_400_000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
    };
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Materialize every template across the 2-week window into concrete slots, with a
 * deterministic spread of occupancy so the UI has empty / partly-booked / full /
 * cancelled cases to render. Occupancy is derived from an index, not the clock.
 */
function generateSlots(): SessionSlot[] {
  const bookedPattern = [0, 1, 4, 2]; // clamped to each slot's capacity below
  const slots: SessionSlot[] = [];
  let idx = 0;

  for (const template of mockTemplates) {
    if (!template.isActive) continue; // a paused rule generates no slots
    for (const date of windowDates()) {
      if (date.weekday !== template.weekday) continue;
      const { startsAt, endsAt } = materializeTemplateSlot(template, date);
      const ymd = `${date.year}${pad(date.month)}${pad(date.day)}`;
      const bookedCount = Math.min(template.capacity, bookedPattern[idx % bookedPattern.length]!);
      const status: SlotStatus = 'published';

      slots.push({
        id: `sl_${template.id.slice(3)}_${ymd}` as SlotId,
        coachId: template.coachId,
        startsAt,
        endsAt,
        trainingType: template.trainingType,
        capacity: template.capacity,
        bookedCount,
        gender: template.gender,
        level: template.level,
        status,
        templateId: template.id,
        // A full slot reads as confirmed (the fill would have stamped it); anything
        // not-yet-full is pending. Gives both apps confirmed + pending fixtures.
        confirmedAt: bookedCount >= template.capacity ? startsAt : null,
      });
      idx += 1;
    }
  }

  // Cancel one ladies slot (never in the current player's view) so the
  // cancelled-slot UI has a case without disturbing the Book-screen fixtures.
  const toCancel = slots.find((s) => s.gender === 'ladies');
  if (toCancel) {
    toCancel.status = 'cancelled';
    toCancel.bookedCount = 0;
  }

  // Guarantee today's men's-beginner group has one FULL and one BOOKABLE slot,
  // so the Book screen's slot card + FULL state are testable on the default day.
  const today = cairoCalendarDate(MOCK_NOW);
  const todaysMenBeginner = slots.filter(
    (s) =>
      s.trainingType === 'group' &&
      s.gender === 'men' &&
      s.level === 'beginner' &&
      isSameCairoDay(s.startsAt, today),
  );
  if (todaysMenBeginner[0]) todaysMenBeginner[0].bookedCount = todaysMenBeginner[0].capacity;
  if (todaysMenBeginner[1]) todaysMenBeginner[1].bookedCount = 1;

  return slots;
}

function isSameCairoDay(
  instant: SessionSlot['startsAt'],
  day: { year: number; month: number; day: number },
): boolean {
  const c = cairoCalendarDate(instant);
  return c.year === day.year && c.month === day.month && c.day === day.day;
}

/**
 * Ad-hoc demo slots (templateId null) that don't come from the weekly schedule.
 * They exist so the Sessions/cancellation UI has the two cases the generated
 * grid can't produce against a fixed MOCK_NOW: a booking that starts INSIDE the
 * 3-hour cancellation window (the forfeit path), and a future booking whose
 * paying credit has since expired (the "refund but worthless" edge). Kept out of
 * the index-based booking picks in bookings.ts (which filter to template slots),
 * so adding them here doesn't shift the attended/no-show/cancelled fixtures.
 */
const adHocSlots: SessionSlot[] = [
  // Starts ~2h from now → inside the 3-hour window → cancelling forfeits.
  {
    id: 'sl_soon_indiv_20260715' as SlotId,
    coachId: 'co_karim' as CoachId,
    startsAt: hoursFromNow(2),
    endsAt: hoursFromNow(3),
    trainingType: 'individual',
    capacity: 1,
    bookedCount: 1,
    gender: null,
    level: null,
    status: 'published',
    templateId: null,
    confirmedAt: hoursFromNow(2), // 1/1 individual → filled → confirmed
  },
  // A duo session ~5 days out, paid from a batch that has since expired. Cancelling
  // outside the window returns the credit to that batch — where it's already dead.
  {
    id: 'sl_future_duo_20260720' as SlotId,
    coachId: 'co_karim' as CoachId,
    startsAt: hoursFromNow(120),
    endsAt: hoursFromNow(121),
    trainingType: 'duo',
    capacity: 2,
    bookedCount: 1,
    gender: null,
    level: null,
    status: 'published',
    templateId: null,
    confirmedAt: null, // 1/2 duo → still pending
  },
];

export const mockSlots: SessionSlot[] = [...generateSlots(), ...adHocSlots];
