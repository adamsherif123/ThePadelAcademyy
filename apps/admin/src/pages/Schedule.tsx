import type { AvailabilityTemplate, SessionSlot } from '@tpa/types';
import { CalendarDays, Repeat } from 'lucide-react';
import { useState } from 'react';

import { GenerateModal } from '../calendar/GenerateModal';
import { OneOffModal } from '../calendar/OneOffModal';
import { SlotModal } from '../calendar/SlotModal';
import { TemplateModal } from '../calendar/TemplateModal';
import { TemplatesPanel } from '../calendar/TemplatesPanel';
import { WeekCalendar } from '../calendar/WeekCalendar';
import { useAdminData } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { ErrorView, LoadingView, PageHeader, SegmentedTabs } from '../ui';
import styles from './Schedule.module.css';

/** Availability-template modal target: create (new) or edit an existing rule. */
type TemplateTarget = { mode: 'new' } | { mode: 'edit'; template: AvailabilityTemplate };

/** Schedule route: the week calendar (S4c) + availability templates & generation (S4d). */
export function Schedule() {
  const { now } = useSession();
  const data = useAdminData();
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<SessionSlot | null>(null);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  const [generating, setGenerating] = useState(false);
  const [oneOff, setOneOff] = useState(false);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Schedule"
        subtitle="Manage the training calendar and the recurring weekly sessions that generate bookable slots. The academy runs Sunday–Wednesday, 5–11 PM."
      />

      <div className={styles.tabs}>
        <SegmentedTabs
          tabs={[
            { value: 'calendar', label: 'Week calendar', icon: CalendarDays },
            { value: 'templates', label: 'Recurring sessions', icon: Repeat },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'calendar' ? (
        <WeekCalendar
          now={now}
          weekOffset={weekOffset}
          templates={data.templates}
          slots={data.slots}
          coaches={data.coaches}
          onPrevWeek={() => setWeekOffset((w) => w - 1)}
          onNextWeek={() => setWeekOffset((w) => w + 1)}
          onSlotClick={setSelected}
          onAddOneOff={() => setOneOff(true)}
        />
      ) : (
        <TemplatesPanel
          coaches={data.coaches}
          templates={data.templates}
          slots={data.slots}
          onNew={() => setTemplateTarget({ mode: 'new' })}
          onEdit={(template) => setTemplateTarget({ mode: 'edit', template })}
          onGenerate={() => setGenerating(true)}
        />
      )}

      {selected ? (
        <SlotModal
          slot={selected}
          slots={data.slots}
          bookings={data.bookings}
          players={data.players}
          batches={data.batches}
          coaches={data.coaches}
          templates={data.templates}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {templateTarget ? (
        <TemplateModal
          template={templateTarget.mode === 'edit' ? templateTarget.template : undefined}
          coaches={data.coaches}
          onClose={() => setTemplateTarget(null)}
        />
      ) : null}
      {generating ? (
        <GenerateModal
          templates={data.templates}
          slots={data.slots}
          coaches={data.coaches}
          onClose={() => setGenerating(false)}
        />
      ) : null}
      {oneOff ? (
        <OneOffModal
          coaches={data.coaches}
          slots={data.slots}
          templates={data.templates}
          onClose={() => setOneOff(false)}
        />
      ) : null}
    </div>
  );
}
