import { cairoCalendarDate, formatInstantTime, formatMonthDay } from '@tpa/core';
import type { CoachId, IsoInstant } from '@tpa/types';
import { useState } from 'react';

import { commitGeneration, generateSlots, type SkipReason } from '../data/generate';
import { coachById } from '../data/selectors';
import { useSession } from '../session/SessionProvider';
import { Button, Input, Modal } from '../ui';
import styles from './GenerateModal.module.css';

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The Cairo calendar date `days` after now's Cairo date, as 'YYYY-MM-DD'. */
function cairoDatePlus(nowIso: IsoInstant, days: number): string {
  const c = cairoCalendarDate(nowIso);
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const SKIP_LABEL: Record<SkipReason, string> = {
  already_exists: 'already on the calendar',
  in_past: 'in the past',
  coach_conflict: 'coach double-booked',
};

const SKIP_ORDER: SkipReason[] = ['already_exists', 'coach_conflict', 'in_past'];

/**
 * Generate slots — preview THEN commit, never one click. The admin picks a date
 * range; this shows exactly what a commit would create (count, days, coaches) and,
 * just as importantly, what it would SKIP and why (already exists / coach conflict /
 * in the past). Only on confirm are the slots written. Re-opening after a run shows
 * everything as "already on the calendar" — idempotency, made visible.
 */
export function GenerateModal({ onClose }: { onClose: () => void }) {
  const { now } = useSession();
  const [fromDate, setFromDate] = useState(() => cairoDatePlus(now, 0));
  const [toDate, setToDate] = useState(() => cairoDatePlus(now, 14));

  const invalidRange = fromDate === '' || toDate === '' || toDate < fromDate;
  const plan = invalidRange ? null : generateSlots({ fromDate, toDate }, now);

  const created = plan?.toCreate ?? [];
  const days = new Set(created.map((p) => p.date)).size;

  const perCoach = new Map<CoachId, number>();
  for (const p of created) perCoach.set(p.slot.coachId, (perCoach.get(p.slot.coachId) ?? 0) + 1);

  const skipsByReason = SKIP_ORDER.map((reason) => ({
    reason,
    items: (plan?.skipped ?? []).filter((s) => s.reason === reason),
  })).filter((g) => g.items.length > 0);

  const onCommit = () => {
    if (!plan || plan.toCreate.length === 0) return;
    commitGeneration(plan);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Schedule"
      title="Generate slots"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onCommit} disabled={!plan || created.length === 0}>
            {created.length === 0 ? 'Nothing to create' : `Create ${created.length} session${created.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.intro}>
          Materialize bookable slots from active recurring sessions across a date range. Nothing is created
          until you confirm — and a session that already exists, is booked, or clashes is skipped, so
          re-running is always safe.
        </p>

        <div className={styles.range}>
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>

        {invalidRange ? (
          <p className={styles.error}>Pick a valid date range — the end can’t be before the start.</p>
        ) : (
          <>
            {created.length > 0 ? (
              <div className={styles.summary}>
                <span className={styles.summaryNum}>{created.length}</span>
                <div>
                  <div className={styles.summaryText}>
                    session{created.length === 1 ? '' : 's'} to create
                  </div>
                  <div className={styles.summarySub}>
                    across {days} open day{days === 1 ? '' : 's'} · {perCoach.size} coach
                    {perCoach.size === 1 ? '' : 'es'}
                  </div>
                </div>
              </div>
            ) : (
              <p className={styles.empty}>
                Nothing new to create in this range. Everything the active recurring sessions would
                produce is already on the calendar (or in the past). Widen the range to schedule further
                ahead.
              </p>
            )}

            {perCoach.size > 0 ? (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>By coach</span>
                <div className={styles.coachList}>
                  {[...perCoach.entries()].map(([id, count]) => (
                    <span key={id} className={styles.coachChip}>
                      <span className={styles.coachChipNum}>{count}</span>
                      {coachById(id)?.name ?? 'Coach'}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {skipsByReason.length > 0 ? (
              <div className={styles.section}>
                <span className={styles.sectionTitle}>Skipped</span>
                <div className={styles.skips}>
                  {skipsByReason.map(({ reason, items }) => {
                    const eg = items[0]!;
                    const egCoach = coachById(eg.template.coachId)?.name ?? 'Coach';
                    const example =
                      reason === 'coach_conflict'
                        ? `${egCoach}, ${formatMonthDay(eg.startsAt)} ${formatInstantTime(eg.startsAt)}${eg.conflictWith ? ` overlaps ${formatInstantTime(eg.conflictWith)}` : ''}`
                        : `e.g. ${egCoach}, ${formatMonthDay(eg.startsAt)} ${formatInstantTime(eg.startsAt)}`;
                    return (
                      <div key={reason} className={styles.skipRow}>
                        <span className={styles.skipCount}>{items.length}</span>
                        <div className={styles.skipText}>
                          <span className={styles.skipLabel}>{SKIP_LABEL[reason]}</span>
                          <span className={styles.skipEg}>{example}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
