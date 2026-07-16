import type { BookingStatus } from '@tpa/types';

import { Badge, type BadgeTone } from './Badge';

const STATUS: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  booked: { label: 'Booked', tone: 'info' },
  attended: { label: 'Attended', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  no_show: { label: 'No-show', tone: 'warning' },
};

/** A booking-status chip: maps a @tpa/types BookingStatus to label + Badge tone. */
export function StatusChip({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
