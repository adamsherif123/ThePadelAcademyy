import type { News as NewsItem } from '@tpa/types';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';

import { createNews, updateNews } from '../data/news';
import { newsImagePublicUrl, removeNewsImage, uploadNewsImage } from '../lib/api';
import { Button, Input, Modal, Toggle } from '../ui';
import styles from './NewsModal.module.css';

const ERROR_TEXT: Record<string, string> = {
  title_required: 'News needs a title.',
  body_required: 'News needs some body text.',
  news_missing: 'That news item no longer exists.',
  network: 'Something went wrong. Please try again.',
};

/**
 * New or edit news. The image is chosen locally (a File replaces, 'remove' clears
 * it, null keeps whatever's there) exactly like CoachModal's photo handling — the
 * upload happens on save, and a replaced/removed OLD image is only cleaned up
 * AFTER the save succeeds, so a failed save never orphans-deletes a still-in-use
 * image. "Notify all players" only appears on CREATE — editing never re-notifies.
 */
export function NewsModal({ news, onClose }: { news?: NewsItem; onClose: () => void }) {
  const editing = news !== undefined;
  const [title, setTitle] = useState(news?.title ?? '');
  const [body, setBody] = useState(news?.body ?? '');
  const [notifyPlayers, setNotifyPlayers] = useState(false);
  const [image, setImage] = useState<File | 'remove' | null>(null);
  const [preview, setPreview] = useState<string | null>(
    news?.imagePath ? newsImagePublicUrl(news.imagePath) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImage(file);
    setPreview(url);
    setError(null);
  };

  const onRemoveImage = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setImage('remove');
    setPreview(null);
    setError(null);
  };

  const onSubmit = async () => {
    setSaving(true);
    setError(null);
    const oldPath = news?.imagePath ?? null;
    try {
      // Resolve the image_path this save uses: File -> upload (new path); 'remove'
      // -> null; untouched (null) -> whatever's already there.
      let imagePath: string | null;
      if (image === 'remove') imagePath = null;
      else if (image instanceof File) imagePath = (await uploadNewsImage(image)).path;
      else imagePath = oldPath;

      const res = editing
        ? await updateNews(news.id, title, body, imagePath)
        : await createNews(title, body, imagePath, notifyPlayers);

      if (!res.ok) {
        setError(ERROR_TEXT[res.reason] ?? 'Could not save the news item.');
        setSaving(false);
        return;
      }
      if (oldPath && oldPath !== imagePath) await removeNewsImage(oldPath).catch(() => undefined);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  const canSave = title.trim() !== '' && body.trim() !== '';

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Announcements"
      title={editing ? 'Edit news' : 'New news'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSave || saving}>
            {saving ? 'Saving…' : editing ? 'Save news' : 'Publish news'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.imageRow}>
          <div className={styles.thumb} data-empty={!preview}>
            {preview ? <img src={preview} alt="" className={styles.thumbImg} /> : <ImagePlus size={22} aria-hidden />}
          </div>
          <div className={styles.imageActions}>
            <div className={styles.imageButtons}>
              <Button
                size="sm"
                variant="secondary"
                icon={ImagePlus}
                onClick={() => fileRef.current?.click()}
                disabled={saving}
              >
                {preview ? 'Change image' : 'Upload image'}
              </Button>
              {preview ? (
                <Button size="sm" variant="secondary" onClick={onRemoveImage} disabled={saving}>
                  Remove
                </Button>
              ) : null}
            </div>
            <span className={styles.imageHint}>Square images look best. Optional — news can be text-only.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the announcement?" />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="news-body">
            Body
          </label>
          <textarea
            id="news-body"
            className={styles.textarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Plain text — no rich formatting."
          />
        </div>

        {!editing ? (
          <div className={styles.notifyRow}>
            <div className={styles.notifyText}>
              <span className={styles.notifyTitle}>Notify all players</span>
              <span className={styles.notifySub}>
                {notifyPlayers
                  ? 'Every player gets a push notification when this is published.'
                  : 'Published silently — visible in the feed, no push.'}
              </span>
            </div>
            <Toggle checked={notifyPlayers} onChange={setNotifyPlayers} label="Notify all players" />
          </div>
        ) : (
          <p className={styles.editNote}>Editing never sends a notification — only the original publish does.</p>
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
