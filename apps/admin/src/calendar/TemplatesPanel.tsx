import { formatLocalTimeRange } from '@tpa/core';
import type { AvailabilityTemplate } from '@tpa/types';
import { CalendarPlus, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { allCoaches, allSlots, allTemplates } from '../data/selectors';
import { deleteTemplate, setTemplateActive } from '../data/templates';
import { useAdminStore } from '../data/store';
import { Avatar, Badge, Button, Card, EmptyState, Modal, TypePill, groupTags } from '../ui';
import styles from './TemplatesPanel.module.css';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const byWeekdayThenStart = (a: AvailabilityTemplate, b: AvailabilityTemplate) =>
  a.weekday - b.weekday || a.startTime.localeCompare(b.startTime);

/**
 * The Availability-templates tab: one card per coach listing their recurring weekly
 * rules. Editing/creating is owned by the parent (it layers the template modal);
 * deleting is a guarded confirm owned here, because deleting a rule is a foot-gun —
 * its already-generated sessions stay on the calendar, so we steer toward pausing.
 */
export function TemplatesPanel({
  onNew,
  onEdit,
  onGenerate,
}: {
  onNew: () => void;
  onEdit: (template: AvailabilityTemplate) => void;
  onGenerate: () => void;
}) {
  useAdminStore(); // re-render after a create/edit/pause/delete
  const coaches = allCoaches();
  const templates = allTemplates();
  const [deleting, setDeleting] = useState<AvailabilityTemplate | null>(null);

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

      {templates.length === 0 ? (
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
            const rules = templates.filter((t) => t.coachId === coach.id).sort(byWeekdayThenStart);
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
                              aria-label={`Edit ${DAY_SHORT[t.weekday]} ${t.trainingType} recurring session`}
                              onClick={() => onEdit(t)}
                            >
                              <Pencil size={15} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.danger}`}
                              aria-label={`Delete ${DAY_SHORT[t.weekday]} ${t.trainingType} recurring session`}
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
        <DeleteTemplateConfirm template={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}

/**
 * Guarded delete. It counts the sessions the rule already put on the calendar and
 * how many carry bookings, then makes the safe path (Pause) the obvious one —
 * deletion never removes a scheduled or booked session, only the rule.
 */
function DeleteTemplateConfirm({
  template,
  onClose,
}: {
  template: AvailabilityTemplate;
  onClose: () => void;
}) {
  const generated = allSlots().filter((s) => s.templateId === template.id);
  const booked = generated.filter((s) => s.bookedCount > 0).length;

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Recurring session"
      title="Delete this recurring session?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {template.isActive ? (
            <Button
              variant="secondary"
              onClick={() => {
                setTemplateActive(template.id, false);
                onClose();
              }}
            >
              Pause instead
            </Button>
          ) : null}
          <Button
            variant="destructive"
            icon={Trash2}
            onClick={() => {
              deleteTemplate(template.id);
              onClose();
            }}
          >
            Delete recurring session
          </Button>
        </>
      }
    >
      <div className={styles.confirm}>
        <p className={styles.confirmLead}>
          Deleting removes the recurring session so it stops generating new slots. It does not remove
          any session already on the calendar.
        </p>
        {generated.length > 0 ? (
          <p className={styles.confirmImpact}>
            This rule has generated {generated.length} session{generated.length === 1 ? '' : 's'}
            {booked > 0 ? `, ${booked} with players booked` : ''}. {booked > 0 ? 'Those' : 'They'} stay
            on the calendar. If you might use this rule again, pause it instead of deleting.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
