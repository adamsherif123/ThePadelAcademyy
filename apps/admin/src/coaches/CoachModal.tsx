import type { Coach } from '@tpa/types';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { createCoach, updateCoach, uploadCoachPhoto, type SaveCoachResult } from '../data/coaches';
import { allTemplates } from '../data/selectors';
import { Avatar, Button, Input, Modal, Toggle } from '../ui';
import styles from './CoachModal.module.css';

const ERROR_TEXT: Record<string, string> = {
  name_required: 'A coach needs a name.',
  coach_missing: 'That coach no longer exists.',
  photo_failed: 'Could not read that image — try another file.',
};

/**
 * Add or edit a coach. `coach` present → edit; absent → create. A coach is never
 * deleted (they own historical slots/bookings) — "remove" is the On-leave toggle,
 * which also pauses their active recurring sessions so nothing new generates. The
 * photo goes through the uploadCoachPhoto seam; a coach with no photo is a
 * first-class state (Avatar falls back to initials).
 */
export function CoachModal({ coach, onClose }: { coach?: Coach; onClose: () => void }) {
  const editing = coach !== undefined;
  const [name, setName] = useState(coach?.name ?? '');
  const [bio, setBio] = useState(coach?.bio ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(coach?.photoUrl ?? null);
  const [isActive, setIsActive] = useState(coach?.isActive ?? true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Going on leave pauses this coach's currently-active recurring sessions.
  const activeTemplates = editing
    ? allTemplates().filter((t) => t.coachId === coach.id && t.isActive).length
    : 0;
  const goingOnLeave = editing && coach.isActive && !isActive;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setPhotoUrl(await uploadCoachPhoto(file));
    } catch {
      setError(ERROR_TEXT.photo_failed ?? 'Could not read that image.');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = () => {
    const draft = { name, bio, photoUrl, isActive };
    const res: SaveCoachResult = editing ? updateCoach(coach.id, draft) : createCoach(draft);
    if (res.ok) onClose();
    else setError(ERROR_TEXT[res.reason] ?? 'Could not save the coach.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Team"
      title={editing ? 'Edit coach' : 'Add coach'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={name.trim() === '' || uploading}>
            {editing ? 'Save coach' : 'Add coach'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.photoRow}>
          <Avatar name={name || 'Coach'} photoUrl={photoUrl} size={64} />
          <div className={styles.photoActions}>
            <div className={styles.photoButtons}>
              <Button
                size="sm"
                variant="secondary"
                icon={ImagePlus}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : photoUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {photoUrl ? (
                <button type="button" className={styles.removeLink} onClick={() => setPhotoUrl(null)}>
                  Remove
                </button>
              ) : null}
            </div>
            <span className={styles.photoHint}>PNG or JPG. Optional — no photo shows initials.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void onPick(e.target.files?.[0]);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
        </div>

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="coach-bio">
            Bio
          </label>
          <textarea
            id="coach-bio"
            className={styles.textarea}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A sentence on what this coach specialises in."
          />
        </div>

        <div className={styles.activeRow}>
          <div className={styles.activeText}>
            <span className={styles.activeTitle}>{isActive ? 'Active' : 'On leave'}</span>
            <span className={styles.activeSub}>
              {isActive
                ? 'Available to run sessions and hold recurring rules.'
                : 'Not running sessions. Recurring rules are paused; booked sessions stay until you handle them.'}
            </span>
          </div>
          <Toggle checked={isActive} onChange={setIsActive} label="Coach active" />
        </div>

        {goingOnLeave && activeTemplates > 0 ? (
          <p className={styles.note}>
            <AlertTriangle size={15} aria-hidden />
            Going on leave pauses this coach’s {activeTemplates} active recurring session
            {activeTemplates === 1 ? '' : 's'} — no new slots will generate for them. Sessions already
            booked stay on the calendar; reassign or cancel them from Schedule.
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
