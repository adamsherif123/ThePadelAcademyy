import type { AvailabilityTemplate, Coach, CoachId, LocalTime, Weekday } from '@tpa/types';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

import { createTemplate, updateTemplate, type SaveTemplateResult } from '../data/templates';
import { Button, Input, Modal, Select, Toggle, TYPE_PLAYERS } from '../ui';
import {
  GENDER_OPTIONS,
  LEVEL_OPTIONS,
  SESSION_TYPE_OPTIONS,
  WEEKDAY_OPTIONS,
  useSessionDraft,
} from './sessionForm';
import styles from './sessionForm.module.css';

const ERROR_TEXT: Record<string, string> = {
  end_not_after_start: 'End time must be after the start time.',
  capacity_below_one: 'Capacity must be at least 1.',
  group_requires_gender_level: 'Group sessions need a gender and a level.',
  template_missing: 'That recurring session no longer exists.',
  network: 'Something went wrong. Please try again.',
};

/**
 * Create or edit an availability template. `template` present → edit (id + Active
 * toggle shown); absent → create. All the coach/type/capacity/gender/level logic
 * comes from the shared useSessionDraft; this modal adds the weekly-rule time
 * fields (weekday + start/end wall clock). The seam (via @tpa/core) is the real
 * validator — the form just previews the same rules and disables Save when it can.
 */
export function TemplateModal({
  template,
  coaches,
  onClose,
}: {
  template?: AvailabilityTemplate;
  coaches: Coach[];
  onClose: () => void;
}) {
  const editing = template !== undefined;
  const firstCoach = coaches[0]?.id ?? ('co_hany' as CoachId);

  const draft = useSessionDraft({
    coachId: template?.coachId ?? firstCoach,
    trainingType: template?.trainingType ?? 'group',
    capacity: template?.capacity ?? 4,
    gender: template?.gender ?? null,
    level: template?.level ?? null,
  });
  const [weekday, setWeekday] = useState<Weekday>(template?.weekday ?? 0);
  const [startTime, setStartTime] = useState<string>(template?.startTime ?? '17:00');
  const [endTime, setEndTime] = useState<string>(template?.endTime ?? '18:30');
  const [isActive, setIsActive] = useState<boolean>(template?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const timeInvalid = startTime !== '' && endTime !== '' && endTime <= startTime;
  const canSave = startTime !== '' && endTime !== '' && !timeInvalid && draft.capacity >= 1;

  const onSubmit = async () => {
    const payload = {
      coachId: draft.coachId,
      weekday,
      startTime: startTime as LocalTime,
      endTime: endTime as LocalTime,
      trainingType: draft.trainingType,
      capacity: draft.capacity,
      gender: draft.effectiveGender,
      level: draft.effectiveLevel,
      isActive,
    };
    const res: SaveTemplateResult = editing
      ? await updateTemplate(template.id, payload)
      : await createTemplate(payload);
    if (res.ok) {
      onClose();
    } else {
      setError(ERROR_TEXT[res.reason] ?? 'Could not save the recurring session.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Recurring session"
      title={editing ? 'Edit recurring session' : 'New recurring session'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSave}>
            {editing ? 'Save recurring session' : 'Create recurring session'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.grid}>
          <div className={styles.span2}>
            <Select
              label="Coach"
              value={draft.coachId}
              onChange={(e) => draft.setCoachId(e.target.value as CoachId)}
              options={coaches.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <Select
            label="Day"
            value={String(weekday)}
            onChange={(e) => setWeekday(Number(e.target.value) as Weekday)}
            options={WEEKDAY_OPTIONS.map((d) => ({ value: String(d.value), label: d.label }))}
          />
          <Select
            label="Session type"
            value={draft.trainingType}
            onChange={(e) => draft.setTrainingType(e.target.value as typeof draft.trainingType)}
            options={SESSION_TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
          />

          <Input label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />

          <Input
            label="Capacity"
            type="number"
            min={1}
            value={draft.capacity}
            onChange={(e) => draft.setCapacity(Number(e.target.value))}
            hint={TYPE_PLAYERS[draft.trainingType]}
          />
          {draft.requiresGenderLevel ? (
            <Select
              label="Gender group"
              value={draft.gender}
              onChange={(e) => draft.setGender(e.target.value as typeof draft.gender)}
              options={GENDER_OPTIONS.map((g) => ({ value: g.value, label: g.label }))}
            />
          ) : (
            <div />
          )}

          {draft.requiresGenderLevel ? (
            <Select
              label="Level"
              value={draft.level}
              onChange={(e) => draft.setLevel(e.target.value as typeof draft.level)}
              options={LEVEL_OPTIONS.map((l) => ({ value: l.value, label: l.label }))}
            />
          ) : null}
        </div>

        {editing ? (
          <div className={styles.activeRow}>
            <div className={styles.activeText}>
              <span className={styles.activeTitle}>{isActive ? 'Active' : 'Paused'}</span>
              <span className={styles.activeSub}>
                {isActive
                  ? 'Generating slots on open days.'
                  : 'Paused — generates nothing until resumed. Existing sessions are untouched.'}
              </span>
            </div>
            <Toggle checked={isActive} onChange={setIsActive} label="Recurring session active" />
          </div>
        ) : null}

        {timeInvalid ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            End time must be after the start time.
          </p>
        ) : null}
        {error ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
