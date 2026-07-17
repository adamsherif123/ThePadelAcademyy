import { parseInstant } from '@tpa/core';
import type { CoachId, IsoInstant, SessionSlot, SlotId } from '@tpa/types';

import { updateSlot } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runWrite } from './queries';

/**
 * Edit a slot — coach, capacity, start/end time — via the column-limited UPDATE
 * (coach_id, capacity, starts_at, ends_at, status only; booked_count is not
 * grantable, by design). Client re-validation stays (a seam never trusts its
 * caller): capacity can't drop below the seats already booked, end must follow
 * start, and a start can't be MOVED into the past. Coach overlap is NOT blocked here
 * (warn, don't block) — but the DB EXCLUDE constraint is the real guard, so a
 * reschedule that collides returns 'coach_conflict' (23P01) instead of a raw error.
 */
export interface SlotEdit {
  coachId: CoachId;
  capacity: number;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

export type UpdateSlotResult =
  | { ok: true; slot: SessionSlot }
  | { ok: false; reason: 'capacity_below_booked' | 'end_before_start' | 'in_past' | 'coach_conflict' | 'network' };

export async function updateSlotDetails(
  slot: SessionSlot,
  edit: SlotEdit,
  now: IsoInstant,
): Promise<UpdateSlotResult> {
  if (edit.capacity < slot.bookedCount) return { ok: false, reason: 'capacity_below_booked' };
  if (parseInstant(edit.endsAt).getTime() <= parseInstant(edit.startsAt).getTime()) {
    return { ok: false, reason: 'end_before_start' };
  }
  const startMoved = edit.startsAt !== slot.startsAt;
  if (startMoved && parseInstant(edit.startsAt).getTime() <= parseInstant(now).getTime()) {
    return { ok: false, reason: 'in_past' };
  }
  const res = await runWrite(
    () => updateSlot(slot.id, { coachId: edit.coachId, capacity: edit.capacity, startsAt: edit.startsAt, endsAt: edit.endsAt }),
    TOUCHED.slots,
  );
  return res.ok ? { ok: true, slot: res.value } : { ok: false, reason: res.reason };
}

/** Re-export the slot id type callers used from here. */
export type { SlotId };
