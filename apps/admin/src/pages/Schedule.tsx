import type { AvailabilityTemplate, SessionSlot } from '@tpa/types';
import { CalendarDays, Repeat } from 'lucide-react';
import { useState } from 'react';

import { GenerateModal } from '../calendar/GenerateModal';
import { OneOffModal } from '../calendar/OneOffModal';
import { SlotModal } from '../calendar/SlotModal';
import { TemplateModal } from '../calendar/TemplateModal';
import { TemplatesPanel } from '../calendar/TemplatesPanel';
import { WeekCalendar } from '../calendar/WeekCalendar';
import { useAdminStore } from '../data/store';
import { useSession } from '../session/SessionProvider';
import { PageHeader, SegmentedTabs } from '../ui';
import styles from './Schedule.module.css';

/** Availability-template modal target: create (new) or edit an existing rule. */
type TemplateTarget = { mode: 'new' } | { mode: 'edit'; template: AvailabilityTemplate };

/** Schedule route: the week calendar (S4c) + availability templates & generation (S4d). */
export function Schedule() {
  useAdminStore(); // re-render after a cancel/edit/generate mutates the store
  const { now } = useSession();
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<SessionSlot | null>(null);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  const [generating, setGenerating] = useState(false);
  const [oneOff, setOneOff] = useState(false);

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
          onAddOneOff={() => setOneOff(true)}
        />
      ) : (
        <TemplatesPanel
          onNew={() => setTemplateTarget({ mode: 'new' })}
          onEdit={(template) => setTemplateTarget({ mode: 'edit', template })}
          onGenerate={() => setGenerating(true)}
        />
      )}

      {selected ? <SlotModal slot={selected} onClose={() => setSelected(null)} /> : null}
      {templateTarget ? (
        <TemplateModal
          template={templateTarget.mode === 'edit' ? templateTarget.template : undefined}
          onClose={() => setTemplateTarget(null)}
        />
      ) : null}
      {generating ? <GenerateModal onClose={() => setGenerating(false)} /> : null}
      {oneOff ? <OneOffModal onClose={() => setOneOff(false)} /> : null}
    </div>
  );
}
