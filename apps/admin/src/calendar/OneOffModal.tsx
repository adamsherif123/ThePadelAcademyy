import { cairoCalendarDate, formatInstantTime } from '@tpa/core';
import type { AvailabilityTemplate, Coach, CoachId, SessionSlot, SlotId, Weekday } from '@tpa/types';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { useState } from 'react';

import { createOneOffSlot } from '../data/generate';
import { closedWeekdays, findCoachConflict, slotTimesFromWall } from '../data/schedule';
import { coachById } from '../data/selectors';
import { useSession } from '../session/SessionProvider';
import { Button, Input, Modal, Select, TYPE_PLAYERS } from '../ui';
import {
  DURATION_OPTIONS,
  GENDER_OPTIONS,
  LEVEL_OPTIONS,
  SESSION_TYPE_OPTIONS,
  useSessionDraft,
} from './sessionForm';
import styles from './sessionForm.module.css';

const pad = (n: number) => String(n).padStart(2, '0');

const ERROR_TEXT: Record<string, string> = {
  end_before_start: 'The session must end after it starts.',
  in_past: 'That start time is in the past — a session can’t have already happened.',
  capacity_below_one: 'Capacity must be at least 1.',
  group_requires_gender_level: 'Group sessions need a gender and a level.',
  coach_conflict: 'That coach is already booked at this time.',
  network: 'Something went wrong. Please try again.',
};

/**
 * Add a ONE-OFF session (templateId null): a session that isn't part of any weekly
 * rule and may fall outside operating hours. Shares the coach/type/capacity/gender/
 * level logic with the template modal (useSessionDraft) and the wall-clock → UTC
 * conversion with slot editing (slotTimesFromWall, DST-correct). Coach overlap is a
 * WARNING, not a block — consistent with rescheduling.
 */
export function OneOffModal({
  coaches,
  slots,
  templates,
  onClose,
}: {
  coaches: Coach[];
  slots: SessionSlot[];
  templates: AvailabilityTemplate[];
  onClose: () => void;
}) {
  const { now } = useSession();
  const today = cairoCalendarDate(now);
  const firstCoach = coaches[0]?.id ?? ('co_hany' as CoachId);

  const draft = useSessionDraft({
    coachId: firstCoach,
    trainingType: 'group',
    capacity: 4,
    gender: null,
    level: null,
  });
  const [dateStr, setDateStr] = useState(`${today.year}-${pad(today.month)}-${pad(today.day)}`);
  const [startStr, setStartStr] = useState('17:00');
  const [durationMin, setDurationMin] = useState(90);
  const [error, setError] = useState<string | null>(null);

  const [yy, mm, dd] = dateStr.split('-').map(Number);
  const [sh, sm] = startStr.split(':').map(Number);
  const timeValid =
    dateStr !== '' && startStr !== '' && [yy, mm, dd, sh, sm].every((n) => Number.isFinite(n));
  const { startsAt, endsAt } = timeValid
    ? slotTimesFromWall(yy!, mm!, dd!, sh! * 60 + sm!, durationMin)
    : { startsAt: now, endsAt: now };

  const inPast = timeValid && new Date(startsAt).getTime() <= new Date(now).getTime();
  const newWeekday = timeValid ? new Date(Date.UTC(yy!, mm! - 1, dd!)).getUTCDay() : -1;
  const closedDay = newWeekday >= 0 && closedWeekdays(templates).has(newWeekday as Weekday);
  const conflict = timeValid
    ? findCoachConflict(slots, draft.coachId, startsAt, endsAt, 'sl_oneoff_probe' as SlotId)
    : undefined;
  const conflictCoach = coachById(coaches, draft.coachId)?.name ?? 'this coach';

  const canSave = timeValid && !inPast && draft.capacity >= 1;

  const onSubmit = async () => {
    const res = await createOneOffSlot(
      {
        coachId: draft.coachId,
        trainingType: draft.trainingType,
        capacity: draft.capacity,
        gender: draft.effectiveGender,
        level: draft.effectiveLevel,
        startsAt,
        endsAt,
      },
      now,
    );
    if (res.ok) onClose();
    else setError(ERROR_TEXT[res.reason] ?? 'Could not create the session.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Schedule"
      title="Add a one-off session"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={CalendarClock} onClick={() => void onSubmit()} disabled={!canSave}>
            Add session
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

          <Input label="Date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          <Select
            label="Session type"
            value={draft.trainingType}
            onChange={(e) => draft.setTrainingType(e.target.value as typeof draft.trainingType)}
            options={SESSION_TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
          />

          <Input label="Start" type="time" value={startStr} onChange={(e) => setStartStr(e.target.value)} />
          <Select
            label="Duration"
            value={String(durationMin)}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            options={DURATION_OPTIONS.map((d) => ({ value: String(d.value), label: d.label }))}
          />

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

        {inPast ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {ERROR_TEXT.in_past}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error}>
            <AlertTriangle size={15} aria-hidden />
            {error}
          </p>
        ) : null}
        {conflict && !inPast ? (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {conflictCoach} already coaches {formatInstantTime(conflict.startsAt)} –{' '}
            {formatInstantTime(conflict.endsAt)} — that overlaps, and they can’t be in two places.
          </p>
        ) : null}
        {closedDay && !inPast ? (
          <p className={styles.note}>
            <CalendarClock size={15} aria-hidden />
            That’s normally a closed day — fine for a one-off, but worth a glance.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
