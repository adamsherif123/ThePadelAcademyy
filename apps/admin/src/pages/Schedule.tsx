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
import { useSelectedLocation } from '../data/useSelectedLocation';
import { useSession } from '../session/SessionProvider';
import { ErrorView, LoadingView, PageHeader, SegmentedTabs, Select, useIsMobile } from '../ui';
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
  // Before the early returns: hooks cannot be conditional. It reads an empty
  // list while the query is pending and simply resolves to null.
  const loc = useSelectedLocation(data.locations);

  if (data.isPending) return <LoadingView />;
  if (data.isError) return <ErrorView onRetry={data.refetch} />;

  // today's weekday + dayOffset, split into "which week" and "which day of it".
  // floor()/modulo (not truncation) so negative offsets land in the previous week
  // rather than collapsing onto week 0.
  const cursor = cairoCalendarDate(now).weekday + dayOffset;
  const weekOffset = Math.floor(cursor / 7);
  const selectedIndex = ((cursor % 7) + 7) % 7;
  // ── everything below the calendar is scoped to the selected branch ──
  // Filter the INPUTS, not @tpa/core's rule: isDayOpen keeps one signature and
  // one meaning, and the caller decides what "the schedule" is. A branch with no
  // templates and no slots on a date is CLOSED there even if the other branch is
  // wide open, which is the whole point.
  const locTemplates = data.templates.filter((t) => t.locationId === loc.id);
  const locSlots = data.slots.filter((s) => s.locationId === loc.id);
  const columns = weekColumns(locTemplates, locSlots, now, weekOffset);
  const createAt = loc.id;

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Schedule"
        subtitle={
          loc.location
            ? `Manage the training calendar and the recurring weekly sessions that generate bookable slots. ${loc.location.name} runs ${loc.location.hoursText}.`
            : 'Manage the training calendar and the recurring weekly sessions that generate bookable slots.'
        }
      />

      {/* Above the tabs, not inside WeekCalendar's nav row: the Recurring
          sessions tab has to follow the same branch, and a picker living in the
          week header would vanish when the admin switched tabs. Always rendered,
          even with one branch, so "which branch am I scheduling?" is never a
          question the admin has to hold in their head. */}
      <div className={styles.locationBar}>
        <Select
          label="Location"
          value={loc.id ?? ''}
          onChange={(e) => loc.select(e.target.value as typeof loc.id & string)}
          options={loc.options.map((l) => ({ value: l.id, label: l.name }))}
        />
      </div>

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
            slots={locSlots}
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
            templates={locTemplates}
            slots={locSlots}
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
          templates={locTemplates}
          slots={locSlots}
          now={now}
          locationName={loc.location?.name ?? ''}
          locationHours={loc.location?.hoursText ?? ''}
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
          locations={data.locations}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {templateTarget && createAt ? (
        <TemplateModal
          template={templateTarget.mode === 'edit' ? templateTarget.template : undefined}
          coaches={data.coaches}
          locationId={createAt}
          locationName={loc.location?.name ?? ''}
          onClose={() => setTemplateTarget(null)}
        />
      ) : null}
      {/* templates SCOPED to the branch; slots GLOBAL — a coach booked at
          another branch is still a clash, and hiding it would only move the
          failure to the DB's exclusion constraint on commit. */}
      {generating ? (
        <GenerateModal
          templates={locTemplates}
          slots={data.slots}
          coaches={data.coaches}
          locations={data.locations}
          locationName={loc.location?.name ?? ''}
          onClose={() => setGenerating(false)}
        />
      ) : null}
      {/* Same split as GenerateModal: global slots, scoped templates. */}
      {oneOff && createAt ? (
        <OneOffModal
          coaches={data.coaches}
          slots={data.slots}
          templates={locTemplates}
          locations={data.locations}
          locationId={createAt}
          locationName={loc.location?.name ?? ''}
          defaultDate={oneOff.date}
          onClose={() => setOneOff(null)}
        />
      ) : null}
    </div>
  );
}
