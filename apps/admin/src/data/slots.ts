import { parseInstant } from '@tpa/core';
import type { CoachId, IsoInstant, SessionSlot, SlotId } from '@tpa/types';

import { rescheduleSessionRpc, type RescheduleReason } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Edit a slot — coach, capacity, start/end time — via the reschedule_session RPC
 * (S12). It replaced the old direct column UPDATE so the row change and the
 * "your session moved" notifications to booked players are ONE atomic transaction,
 * minted by an RPC (the notifications invariant). Client re-validation stays (a seam
 * never trusts its caller): capacity can't drop below the seats already booked, end
 * must follow start, a MOVED start can't be in the past — and the DB re-checks all of
 * them. Coach overlap is warned-not-blocked here, but the DB EXCLUDE constraint is the
 * real guard, surfaced by the RPC as 'coach_conflict'.
 */
export interface SlotEdit {
  coachId: CoachId;
  capacity: number;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

export type UpdateSlotResult =
  | { ok: true; moved: boolean }
  | { ok: false; reason: RescheduleReason | 'network' };

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
  return runRpc(
    () => rescheduleSessionRpc(slot.id, {
      coachId: edit.coachId, capacity: edit.capacity, startsAt: edit.startsAt, endsAt: edit.endsAt,
    }),
    TOUCHED.slots,
  );
}

/** Re-export the slot id type callers used from here. */
export type { SlotId };
