import type { SessionSlot } from '@tpa/types';
import { CalendarDays, Repeat } from 'lucide-react';
import { useState } from 'react';

import { SlotModal } from '../calendar/SlotModal';
import { WeekCalendar } from '../calendar/WeekCalendar';
import { useAdminStore } from '../data/store';
import { useSession } from '../session/SessionProvider';
import { Card, EmptyState, PageHeader, SegmentedTabs } from '../ui';
import styles from './Schedule.module.css';

/** Schedule route: the week calendar (S4c) + a stub for templates (S4d). */
export function Schedule() {
  useAdminStore(); // re-render after a cancel/edit mutates the store
  const { now } = useSession();
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<SessionSlot | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Schedule"
        subtitle="Manage the training calendar and the recurring availability templates that generate bookable slots. The academy runs Sunday–Wednesday, 5–11 PM."
      />

      <div className={styles.tabs}>
        <SegmentedTabs
          tabs={[
            { value: 'calendar', label: 'Week calendar', icon: CalendarDays },
            { value: 'templates', label: 'Availability templates', icon: Repeat },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'calendar' ? (
        <WeekCalendar
          now={now}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset((w) => w - 1)}
          onNextWeek={() => setWeekOffset((w) => w + 1)}
          onSlotClick={setSelected}
        />
      ) : (
        <Card>
          <EmptyState
            icon={Repeat}
            title="Availability templates"
            message="The recurring templates that generate bookable slots (and the generate/add-one-off actions) arrive in the next session."
          />
        </Card>
      )}

      {selected ? <SlotModal slot={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
