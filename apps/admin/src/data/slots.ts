import { parseInstant } from '@tpa/core';
import type { CoachId, IsoInstant, SessionSlot, SlotId } from '@tpa/types';

import { commitSlotUpdate, getSlots } from './store';

/**
 * Edit a slot — coach, capacity, and start/end time — in one "edit this slot"
 * seam (S10 replaces the body). It re-validates EVERYTHING, since a seam never
 * trusts its caller:
 *  - capacity below the current bookedCount is impossible (can't seat fewer than
 *    are already booked);
 *  - end must be after start;
 *  - the start can't be MOVED into the past (a session can't have already happened
 *    at a time you just chose); an unchanged start that's already past is fine —
 *    editing a past session's coach isn't rescheduling it.
 * Coach overlap is deliberately NOT enforced here (warn, don't block — see report).
 * Rescheduling changes only the slot's fields; bookings and bookedCount are left
 * untouched, so moving a session never silently drops anyone.
 */
export interface SlotEdit {
  coachId: CoachId;
  capacity: number;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

export type UpdateSlotResult =
  | { ok: true; slot: SessionSlot }
  | { ok: false; reason: 'slot_missing' | 'capacity_below_booked' | 'end_before_start' | 'in_past' };

export function updateSlotDetails(slotId: SlotId, edit: SlotEdit, now: IsoInstant): UpdateSlotResult {
  const slot = getSlots().find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };
  if (edit.capacity < slot.bookedCount) return { ok: false, reason: 'capacity_below_booked' };
  if (parseInstant(edit.endsAt).getTime() <= parseInstant(edit.startsAt).getTime()) {
    return { ok: false, reason: 'end_before_start' };
  }
  const startMoved = edit.startsAt !== slot.startsAt;
  if (startMoved && parseInstant(edit.startsAt).getTime() <= parseInstant(now).getTime()) {
    return { ok: false, reason: 'in_past' };
  }
  const updated: SessionSlot = {
    ...slot,
    coachId: edit.coachId,
    capacity: edit.capacity,
    startsAt: edit.startsAt,
    endsAt: edit.endsAt,
  };
  commitSlotUpdate(updated); // bookedCount + bookings untouched — the slot just moves
  return { ok: true, slot: updated };
}
