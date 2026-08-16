import { formatLocalTimeRange } from '@tpa/core';
import type { AvailabilityTemplate, IsoInstant, Coach, SessionSlot } from '@tpa/types';
import { AlertTriangle, CalendarPlus, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { deleteTemplate, setTemplateActive } from '../data/templates';
import { Avatar, Badge, Button, Card, EmptyState, Modal, TypePill, groupTags, trainingLabelFor } from '../ui';
import styles from './TemplatesPanel.module.css';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Delete/pause reason → admin-facing copy. Always has a fallback. */
const ERROR_TEXT: Record<string, string> = {
  not_admin: "You don't have permission.",
  template_missing: 'That recurring session no longer exists.',
  network: 'Something went wrong. Please try again.',
};
const copyFor = (reason: string): string => ERROR_TEXT[reason] ?? 'Something went wrong. Please try again.';

const byWeekdayThenStart = (a: AvailabilityTemplate, b: AvailabilityTemplate) =>
  a.weekday - b.weekday || a.startTime.localeCompare(b.startTime);

/**
 * The Availability-templates tab: one card per coach listing their recurring weekly
 * rules. Editing/creating is owned by the parent (it layers the template modal);
 * deleting is a guarded confirm owned here, because deleting a rule is a foot-gun —
 * its already-generated sessions stay on the calendar, so we steer toward pausing.
 */
export function TemplatesPanel({
  coaches,
  templates,
  slots,
  now,
  onNew,
  onEdit,
  onGenerate,
}: {
  coaches: Coach[];
  templates: AvailabilityTemplate[];
  slots: SessionSlot[];
  now: IsoInstant;
  onNew: () => void;
  onEdit: (template: AvailabilityTemplate) => void;
  onGenerate: () => void;
}) {
  const [deleting, setDeleting] = useState<AvailabilityTemplate | null>(null);
  // A deleted (retired) rule is gone from the admin's perspective — it never
  // shows up here again, whether as active or paused. Same convention as
  // Player.deletedAt / activePlayers().
  const liveTemplates = templates.filter((t) => t.deletedAt == null);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <p className={styles.explainer}>
          Each rule is ONE repeating session at a set time — a 6–8 PM rule makes a single two-hour
          session, not a window that gets divided up. A slot is generated per open day
          (Sunday–Wednesday, 5–11 PM). Editing a rule never changes sessions that are already booked.
        </p>
        <div className={styles.headActions}>
          <Button variant="secondary" icon={CalendarPlus} onClick={onGenerate}>
            Generate slots
          </Button>
          <Button icon={Plus} onClick={onNew}>
            New recurring session
          </Button>
        </div>
      </div>

      {liveTemplates.length === 0 ? (
        <Card>
          <EmptyState
            icon={Repeat}
            title="No recurring sessions yet"
            message="Recurring sessions are the weekly rules that generate bookable slots — one session each. Create your first to get the calendar going."
            action={
              <Button icon={Plus} onClick={onNew}>
                New recurring session
              </Button>
            }
          />
        </Card>
      ) : (
        <div className={styles.grid}>
          {coaches.map((coach) => {
            const rules = liveTemplates.filter((t) => t.coachId === coach.id).sort(byWeekdayThenStart);
            return (
              <div key={coach.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <Avatar name={coach.name} photoUrl={coach.photoUrl} size={44} />
                  <div className={styles.coachInfo}>
                    <span className={styles.coachName}>{coach.name}</span>
                    <span className={styles.coachBio}>{coach.bio}</span>
                  </div>
                  {!coach.isActive ? <Badge tone="warning">On leave</Badge> : null}
                </div>

                {rules.length === 0 ? (
                  <p className={styles.coachEmpty}>No recurring sessions for this coach yet.</p>
                ) : (
                  <div className={styles.rows}>
                    {rules.map((t) => {
                      const tags = groupTags(t.gender, t.level);
                      return (
                        <div key={t.id} className={styles.row} data-paused={!t.isActive}>
                          <div className={styles.when}>
                            <span className={styles.day}>{DAY_SHORT[t.weekday]}</span>
                            <span className={styles.time}>{formatLocalTimeRange(t.startTime, t.endTime)}</span>
                          </div>
                          <div className={styles.what}>
                            <TypePill type={t.trainingType} />
                            {tags ? <span className={styles.tags}>{tags}</span> : null}
                          </div>
                          <div className={styles.rowEnd}>
                            <Badge tone={t.isActive ? 'info' : 'neutral'}>
                              {t.isActive ? 'Active' : 'Paused'}
                            </Badge>
                            <button
                              type="button"
                              className={styles.iconBtn}
                              aria-label={`Edit ${DAY_SHORT[t.weekday]} ${trainingLabelFor(t.trainingType)} recurring session`}
                              onClick={() => onEdit(t)}
                            >
                              <Pencil size={15} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.danger}`}
                              aria-label={`Delete ${DAY_SHORT[t.weekday]} ${trainingLabelFor(t.trainingType)} recurring session`}
                              onClick={() => setDeleting(t)}
                            >
                              <Trash2 size={15} aria-hidden />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleting ? (
        <DeleteTemplateConfirm template={deleting} slots={slots} now={now} onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}

/**
 * Guarded delete. Shows the REAL blast radius before confirming: how many
 * upcoming sessions this rule generated will be cancelled (academy
 * cancellation — refunded regardless of the cancellation window) and how many booked
 * seats that refunds. Past sessions are never part of this count — they stay
 * exactly as delivered, no matter what.
 */
function DeleteTemplateConfirm({
  template,
  slots,
  now,
  onClose,
}: {
  template: AvailabilityTemplate;
  slots: SessionSlot[];
  now: IsoInstant;
  onClose: () => void;
}) {
  const nowMs = new Date(now).getTime();
  const generated = slots.filter((s) => s.templateId === template.id);
  const future = generated.filter((s) => s.status !== 'cancelled' && new Date(s.startsAt).getTime() > nowMs);
  const bookedPlayers = future.reduce((sum, s) => sum + s.bookedCount, 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPause = async () => {
    setError(null);
    setBusy(true);
    const res = await setTemplateActive(template.id, false);
    setBusy(false);
    if (res.ok) onClose();
    else setError(copyFor(res.reason));
  };
  const onDelete = async () => {
    setError(null);
    setBusy(true);
    const res = await deleteTemplate(template.id);
    setBusy(false);
    if (res.ok) onClose();
    else setError(copyFor(res.reason));
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Recurring session"
      title="Delete this recurring session?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {template.isActive ? (
            <Button variant="secondary" onClick={() => void onPause()} disabled={busy}>
              Pause instead
            </Button>
          ) : null}
          <Button variant="destructive" icon={Trash2} onClick={() => void onDelete()} disabled={busy}>
            Delete recurring session
          </Button>
        </>
      }
    >
      <div className={styles.confirm}>
        <p className={styles.confirmLead}>
          {future.length > 0
            ? `Deleting this rule stops future generation, cancels its ${future.length} upcoming session${future.length === 1 ? '' : 's'}${
                bookedPlayers > 0
                  ? ` and refunds all ${bookedPlayers} booked player${bookedPlayers === 1 ? '' : 's'} (academy cancellation)`
                  : ''
              }, and keeps past sessions as history.`
            : 'Deleting this rule stops future generation. It has no upcoming sessions to cancel, and keeps past sessions as history.'}
        </p>
        {generated.length > future.length ? (
          <p className={styles.confirmImpact}>
            This rule also has {generated.length - future.length} past session
            {generated.length - future.length === 1 ? '' : 's'} — those are untouched, no refunds, exactly
            as delivered. If you might use this rule again, pause it instead of deleting.
          </p>
        ) : (
          <p className={styles.confirmImpact}>If you might use this rule again, pause it instead of deleting.</p>
        )}
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
