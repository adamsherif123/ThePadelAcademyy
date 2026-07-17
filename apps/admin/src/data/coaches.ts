import {
  ID_PREFIXES,
  TRAINING_TYPES,
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  cairoWeekStart,
  newId,
  parseInstant,
} from '@tpa/core';
import type { Coach, CoachId, IsoInstant, TrainingType } from '@tpa/types';

import { commitCoachSave, commitTemplateSave, getBookings, getCoaches, getSlots, getTemplates } from './store';

/**
 * Coach selectors + the coach CRUD seam. Stats are computed from the store (never
 * hardcoded); the writes are is_admin-gated config, not money, so S10 swaps them
 * for plain INSERT/UPDATE. A coach is NEVER deleted — historical slots/bookings
 * reference them and the FK would reject it — so "remove" is always on-leave
 * (isActive:false).
 */

const ms = (i: IsoInstant): number => parseInstant(i).getTime();

/** [start, end) UTC ms of `now`'s Cairo week (Sunday 00:00 → next Sunday 00:00). */
function cairoWeekBounds(now: IsoInstant): { startMs: number; endMs: number } {
  const start = cairoWeekStart(now);
  const startDate = cairoCalendarDate(start);
  return { startMs: ms(start), endMs: ms(cairoMidnight(addCairoDays(startDate, 7))) };
}

export interface CoachTypeCount {
  type: TrainingType;
  count: number;
}

export interface CoachWeekStats {
  /** Published sessions this Cairo week. */
  sessionsThisWeek: number;
  /** Seats booked across those sessions. */
  seatsBooked: number;
  /** Attended ÷ (attended + no-show) over ALL the coach's sessions, or null if none recorded. */
  attendancePct: number | null;
  /** This-week session counts per type, for the "THIS WEEK" chips (TRAINING_TYPES order). */
  typeCounts: CoachTypeCount[];
}

/**
 * A coach's card stats, derived from the store. sessions/seats are THIS WEEK;
 * attendance is all-time (a rate needs history the week rarely has) and is null —
 * rendered as "—" — until at least one session has been marked attended/no-show.
 */
export function coachWeekStats(coachId: CoachId, now: IsoInstant): CoachWeekStats {
  const { startMs, endMs } = cairoWeekBounds(now);
  const coachSlots = getSlots().filter((s) => s.coachId === coachId);
  const week = coachSlots.filter(
    (s) => s.status === 'published' && ms(s.startsAt) >= startMs && ms(s.startsAt) < endMs,
  );

  const counts = new Map<TrainingType, number>();
  let seatsBooked = 0;
  for (const s of week) {
    counts.set(s.trainingType, (counts.get(s.trainingType) ?? 0) + 1);
    seatsBooked += s.bookedCount;
  }
  const typeCounts = TRAINING_TYPES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => ({
    type: t,
    count: counts.get(t)!,
  }));

  const coachSlotIds = new Set(coachSlots.map((s) => s.id));
  let attended = 0;
  let resolved = 0; // attended + no_show
  for (const b of getBookings()) {
    if (!coachSlotIds.has(b.slotId)) continue;
    if (b.status === 'attended') {
      attended += 1;
      resolved += 1;
    } else if (b.status === 'no_show') {
      resolved += 1;
    }
  }
  const attendancePct = resolved === 0 ? null : Math.round((attended / resolved) * 100);

  return { sessionsThisWeek: week.length, seatsBooked, attendancePct, typeCounts };
}

// --- CRUD seam ---

export interface CoachDraft {
  name: string;
  bio: string;
  photoUrl: string | null;
  isActive: boolean;
}

export type SaveCoachResult =
  | { ok: true; coach: Coach }
  | { ok: false; reason: 'name_required' | 'coach_missing' };

/** Pause every ACTIVE template belonging to a coach — used when they go on leave. */
function pauseTemplatesForCoach(coachId: CoachId): void {
  for (const t of getTemplates()) {
    if (t.coachId === coachId && t.isActive) commitTemplateSave({ ...t, isActive: false });
  }
}

export function createCoach(draft: CoachDraft): SaveCoachResult {
  const name = draft.name.trim();
  if (name === '') return { ok: false, reason: 'name_required' };
  const coach: Coach = {
    id: newId(ID_PREFIXES.coach) as CoachId,
    name,
    bio: draft.bio.trim(),
    photoUrl: draft.photoUrl,
    isActive: draft.isActive,
  };
  commitCoachSave(coach);
  return { ok: true, coach };
}

export function updateCoach(id: CoachId, draft: CoachDraft): SaveCoachResult {
  const current = getCoaches().find((c) => c.id === id);
  if (!current) return { ok: false, reason: 'coach_missing' };
  const name = draft.name.trim();
  if (name === '') return { ok: false, reason: 'name_required' };
  // Going on leave pauses the coach's active templates so no new sessions generate
  // for them; existing (possibly booked) sessions are left untouched. Coming back
  // does NOT auto-resume — the owner re-activates rules deliberately.
  if (current.isActive && !draft.isActive) pauseTemplatesForCoach(id);
  const updated: Coach = { ...current, name, bio: draft.bio.trim(), photoUrl: draft.photoUrl, isActive: draft.isActive };
  commitCoachSave(updated);
  return { ok: true, coach: updated };
}

/** Toggle a coach's active/on-leave state directly (pauses templates on leave). */
export function setCoachActive(id: CoachId, isActive: boolean): SaveCoachResult {
  const current = getCoaches().find((c) => c.id === id);
  if (!current) return { ok: false, reason: 'coach_missing' };
  if (current.isActive && !isActive) pauseTemplatesForCoach(id);
  const updated: Coach = { ...current, isActive };
  commitCoachSave(updated);
  return { ok: true, coach: updated };
}

/**
 * Turn a chosen image File into something the store can hold and Avatar can render.
 * With no storage backend yet, we read the bytes into a data: URL — honest (the
 * real image renders, not a placeholder URL) and self-contained (a plain string in
 * the in-memory store, with no object-URL lifetime to manage). S10 replaces the
 * body with a Supabase Storage upload that returns a public URL; the seam's shape —
 * File in, Promise<string> out — is identical, so the modal and Avatar don't change.
 * A coach with no photo stays a first-class state: Avatar falls back to initials.
 */
export function uploadCoachPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}
