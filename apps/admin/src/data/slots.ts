import type { CoachId, SessionSlot, SlotId } from '@tpa/types';

import { commitSlotUpdate, getSlots } from './store';

/**
 * Edit a slot's coach and capacity (the slot modal's Save). A seam S10 replaces.
 * Capacity below the current bookedCount is an impossible state (you can't seat
 * fewer than are already booked) and is refused — the modal blocks it in the UI,
 * and this refuses too, since a seam never trusts its caller.
 */
export type UpdateSlotResult =
  | { ok: true; slot: SessionSlot }
  | { ok: false; reason: 'slot_missing' | 'capacity_below_booked' };

export function updateSlotDetails(
  slotId: SlotId,
  coachId: CoachId,
  capacity: number,
): UpdateSlotResult {
  const slot = getSlots().find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: 'slot_missing' };
  if (capacity < slot.bookedCount) return { ok: false, reason: 'capacity_below_booked' };
  const updated: SessionSlot = { ...slot, coachId, capacity };
  commitSlotUpdate(updated);
  return { ok: true, slot: updated };
}
