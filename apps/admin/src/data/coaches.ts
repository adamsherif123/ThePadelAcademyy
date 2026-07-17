import {
  TRAINING_TYPES,
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  cairoWeekStart,
  parseInstant,
} from '@tpa/core';
import type { AvailabilityTemplate, Booking, Coach, CoachId, IsoInstant, SessionSlot, TrainingType } from '@tpa/types';

import { insertCoach, updateCoach as updateCoachApi, updateTemplate, uploadCoachPhoto as uploadPhotoApi } from '../lib/api';
import { queryClient, queryKeys, TOUCHED } from '../lib/queryClient';
import { runWrite } from './queries';

export { uploadCoachPhoto } from '../lib/api';

/**
 * Coach stats (pure, over fetched rows) + the coach CRUD seam. Writes are
 * is_admin()-gated config (not money → no RPC): plain INSERT/UPDATE. A coach is
 * NEVER deleted — historical slots/bookings reference them and the FK would reject
 * it — so "remove" is on-leave (isActive:false). Photos live in Supabase Storage.
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
export function coachWeekStats(
  slots: SessionSlot[],
  bookings: Booking[],
  coachId: CoachId,
  now: IsoInstant,
): CoachWeekStats {
  const { startMs, endMs } = cairoWeekBounds(now);
  const coachSlots = slots.filter((s) => s.coachId === coachId);
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
  for (const b of bookings) {
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

/** name/bio/active only; the photo is a separate File argument (see below). */
export interface CoachDraft {
  name: string;
  bio: string;
  isActive: boolean;
}

export type SaveCoachResult =
  | { ok: true; coach: Coach }
  | { ok: false; reason: 'name_required' | 'coach_missing' | 'network' };

/**
 * Pause every ACTIVE template of a coach going on leave (so no new sessions
 * generate for them; existing ones are untouched). Reads the cached templates —
 * the same ones the calendar shows — and flips them one UPDATE at a time.
 */
async function pauseTemplatesForCoach(coachId: CoachId): Promise<void> {
  const templates = queryClient.getQueryData<AvailabilityTemplate[]>(queryKeys.templates) ?? [];
  for (const t of templates) {
    if (t.coachId === coachId && t.isActive) await updateTemplate(t.id, { isActive: false });
  }
}

/**
 * Create a coach, then (if a photo File was chosen) upload it and stamp the coach's
 * photo_url — a new coach has no id until it's inserted, so the upload can only
 * happen after. The modal shows a local preview meanwhile.
 */
export async function createCoach(draft: CoachDraft, photo: File | null): Promise<SaveCoachResult> {
  const name = draft.name.trim();
  if (name === '') return { ok: false, reason: 'name_required' };
  const res = await runWrite(
    () => insertCoach({ name, bio: draft.bio.trim(), photoUrl: null, isActive: draft.isActive }),
    TOUCHED.coaches,
  );
  if (!res.ok) return { ok: false, reason: 'network' };
  if (!photo) return { ok: true, coach: res.value };
  const withPhoto = await runWrite(async () => {
    const url = await uploadPhotoApi(res.value.id, photo);
    return updateCoachApi(res.value.id, { photoUrl: url });
  }, TOUCHED.coaches);
  return withPhoto.ok ? { ok: true, coach: withPhoto.value } : { ok: false, reason: 'network' };
}

/** Edit a coach. `photo` File replaces the headshot; null leaves it as-is. */
export async function updateCoach(id: CoachId, draft: CoachDraft, photo: File | null): Promise<SaveCoachResult> {
  const name = draft.name.trim();
  if (name === '') return { ok: false, reason: 'name_required' };
  const current = queryClient.getQueryData<Coach[]>(queryKeys.coaches)?.find((c) => c.id === id);
  if (current?.isActive && !draft.isActive) await pauseTemplatesForCoach(id);
  const photoUrl = photo ? await uploadPhotoApi(id, photo).catch(() => undefined) : undefined;
  const res = await runWrite(
    () => updateCoachApi(id, { name, bio: draft.bio.trim(), isActive: draft.isActive, ...(photoUrl !== undefined ? { photoUrl } : {}) }),
    TOUCHED.coaches,
  );
  return res.ok ? { ok: true, coach: res.value } : { ok: false, reason: 'network' };
}

/** Toggle active/on-leave directly (pauses templates on leave). */
export async function setCoachActive(id: CoachId, isActive: boolean): Promise<SaveCoachResult> {
  const current = queryClient.getQueryData<Coach[]>(queryKeys.coaches)?.find((c) => c.id === id);
  if (current?.isActive && !isActive) await pauseTemplatesForCoach(id);
  const res = await runWrite(() => updateCoachApi(id, { isActive }), TOUCHED.coaches);
  return res.ok ? { ok: true, coach: res.value } : { ok: false, reason: 'network' };
}
