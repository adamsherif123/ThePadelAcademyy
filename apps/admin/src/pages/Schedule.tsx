import { cairoCalendarDate, type CairoDate } from '@tpa/core';
import type { AvailabilityTemplate, SessionSlot } from '@tpa/types';
import { CalendarDays, Repeat } from 'lucide-react';
import { useState } from 'react';

import { DayCalendar } from '../calendar/DayCalendar';
import { GenerateModal } from '../calendar/GenerateModal';
import { OneOffModal } from '../calendar/OneOffModal';
import { SlotModal } from '../calendar/SlotModal';
import { TemplateModal } from '../calendar/TemplateModal';
import { TemplatesPanel } from '../calendar/TemplatesPanel';
import { WeekCalendar } from '../calendar/WeekCalendar';
import { weekColumns } from '../data/schedule';
import { useAdminData } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { ErrorView, LoadingView, PageHeader, SegmentedTabs, useIsMobile } from '../ui';
import styles from './Schedule.module.css';

/** Availability-template modal target: create (new) or edit an existing rule. */
type TemplateTarget = { mode: 'new' } | { mode: 'edit'; template: AvailabilityTemplate };

/** Schedule route: the week calendar (S4c) + availability templates & generation (S4d). */
export function Schedule() {
  const { now } = useSession();
  const isMobile = useIsMobile();
  const data = useAdminData();
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  // ONE cursor for both views: days from today. Desktop steps it by 7 (a week),
  // mobile by 1 (a day), and the week grid derives its own offset from it — so the
  // two navigations stay on the same week and crossing a week boundary on mobile is
  // just arithmetic, not a mode change.
  const [dayOffset, setDayOffset] = useState(0);
  const [selected, setSelected] = useState<SessionSlot | null>(null);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  const [generating, setGenerating] = useState(false);
  const [oneOff, setOneOff] = useState<{ date?: CairoDate } | null>(null);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  // today's weekday + dayOffset, split into "which week" and "which day of it".
  // floor()/modulo (not truncation) so negative offsets land in the previous week
  // rather than collapsing onto week 0.
  const cursor = cairoCalendarDate(now).weekday + dayOffset;
  const weekOffset = Math.floor(cursor / 7);
  const selectedIndex = ((cursor % 7) + 7) % 7;
  const columns = weekColumns(data.templates, data.slots, now, weekOffset);

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
        isMobile ? (
          <DayCalendar
            columns={columns}
            selectedIndex={selectedIndex}
            slots={data.slots}
            coaches={data.coaches}
            onPrevDay={() => setDayOffset((d) => d - 1)}
            onNextDay={() => setDayOffset((d) => d + 1)}
            onSelectDay={(i) => setDayOffset((d) => d + (i - selectedIndex))}
            onSlotClick={setSelected}
            onAddOneOff={() => setOneOff({ date: columns[selectedIndex]!.date })}
          />
        ) : (
          <WeekCalendar
            now={now}
            weekOffset={weekOffset}
            templates={data.templates}
            slots={data.slots}
            coaches={data.coaches}
            onPrevWeek={() => setDayOffset((d) => d - 7)}
            onNextWeek={() => setDayOffset((d) => d + 7)}
            onSlotClick={setSelected}
            onAddOneOff={() => setOneOff({})}
          />
        )
      ) : (
        <TemplatesPanel
          coaches={data.coaches}
          templates={data.templates}
          slots={data.slots}
          now={now}
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
          defaultDate={oneOff.date}
          onClose={() => setOneOff(null)}
        />
      ) : null}
    </div>
  );
}
