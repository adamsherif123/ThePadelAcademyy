import type { Coach } from '@tpa/types';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { createCoach, updateCoach, type SaveCoachResult } from '../data/coaches';
import { useTemplates } from '../data/queries';
import { Avatar, Button, Input, Modal, Toggle } from '../ui';
import styles from './CoachModal.module.css';

const ERROR_TEXT: Record<string, string> = {
  name_required: 'A coach needs a name.',
  coach_missing: 'That coach no longer exists.',
  network: 'Something went wrong. Please try again.',
};

/**
 * Add or edit a coach. `coach` present → edit; absent → create. A coach is never
 * deleted (they own historical slots/bookings) — "remove" is the On-leave toggle,
 * which also pauses their active recurring sessions so nothing new generates. The
 * photo is a File chosen locally: while editing we show a preview via
 * URL.createObjectURL and pass the File to the seam on save (null keeps the
 * existing photo). A coach with no photo is a first-class state (Avatar falls back
 * to initials).
 */
export function CoachModal({ coach, onClose }: { coach?: Coach; onClose: () => void }) {
  const editing = coach !== undefined;
  const [name, setName] = useState(coach?.name ?? '');
  const [bio, setBio] = useState(coach?.bio ?? '');
  const [isActive, setIsActive] = useState(coach?.isActive ?? true);
  // The File the admin picked this session (null = keep the existing photo on save).
  const [photo, setPhoto] = useState<File | null>(null);
  // What the Avatar shows: a local object URL for a freshly-picked file, else the saved photo.
  const [preview, setPreview] = useState<string | null>(coach?.photoUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const templates = useTemplates();
  // Going on leave pauses this coach's currently-active recurring sessions.
  const activeTemplates = editing
    ? (templates.data ?? []).filter((t) => t.coachId === coach.id && t.isActive).length
    : 0;
  const goingOnLeave = editing && coach.isActive && !isActive;

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPhoto(file);
    setPreview(url);
    setError(null);
  };

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const draft = { name, bio, isActive };
    const res: SaveCoachResult = editing
      ? await updateCoach(coach.id, draft, photo)
      : await createCoach(draft, photo);
    if (res.ok) {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      onClose();
      return;
    }
    setError(ERROR_TEXT[res.reason] ?? 'Could not save the coach.');
    setSaving(false);
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
          <Button onClick={() => void onSubmit()} disabled={name.trim() === '' || saving}>
            {saving ? 'Saving…' : editing ? 'Save coach' : 'Add coach'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.photoRow}>
          <Avatar name={name || 'Coach'} photoUrl={preview} size={64} />
          <div className={styles.photoActions}>
            <div className={styles.photoButtons}>
              <Button
                size="sm"
                variant="secondary"
                icon={ImagePlus}
                onClick={() => fileRef.current?.click()}
                disabled={saving}
              >
                {preview ? 'Change photo' : 'Upload photo'}
              </Button>
            </div>
            <span className={styles.photoHint}>PNG or JPG. Optional — no photo shows initials.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onPick(e.target.files?.[0]);
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
