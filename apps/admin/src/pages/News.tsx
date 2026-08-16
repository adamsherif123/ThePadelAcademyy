import { formatInstantDate } from '@tpa/core';
import type { News as NewsItem } from '@tpa/types';
import { AlertTriangle, Newspaper, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { deleteNews } from '../data/news';
import { useNews } from '../data/queries';
import { newsImagePublicUrl } from '../lib/api';
import { NewsModal } from '../news/NewsModal';
import { Button, ErrorView, LoadingView, Modal, PageHeader } from '../ui';
import styles from './News.module.css';

const DELETE_ERROR_TEXT: Record<string, string> = {
  not_admin: "You don't have permission.",
  news_missing: 'That news item no longer exists.',
  network: 'Something went wrong. Please try again.',
};

/** News route: newest-first announcements, create/edit/delete. */
export function News() {
  const newsQ = useNews();
  const [editing, setEditing] = useState<NewsItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NewsItem | null>(null);

  if (newsQ.isPending) return <LoadingView />;
  if (newsQ.isError) return <ErrorView onRetry={newsQ.refetch} />;

  const news = newsQ.data ?? [];

  return (
    <div>
      <div className={styles.head}>
        <PageHeader
          eyebrow="Announcements"
          title="News"
          subtitle="Post an update for every player — visible in the app's feed for 30 days. Notifying players sends a push; a silent post is feed-only."
        />
        <Button icon={Plus} onClick={() => setEditing('new')}>
          New news
        </Button>
      </div>

      {news.length === 0 ? (
        <div className={styles.empty}>
          <Newspaper size={28} aria-hidden />
          <p>No news yet. Publish the first update.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {news.map((n) => (
            <NewsCard key={n.id} news={n} onEdit={() => setEditing(n)} onDelete={() => setDeleting(n)} />
          ))}
        </div>
      )}

      {editing ? <NewsModal news={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <NewsDeleteConfirm news={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

function NewsCard({ news, onEdit, onDelete }: { news: NewsItem; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={styles.card}>
      <div className={styles.thumb} data-empty={!news.imagePath}>
        {news.imagePath ? (
          <img src={newsImagePublicUrl(news.imagePath)} alt="" className={styles.thumbImg} />
        ) : (
          <Newspaper size={22} aria-hidden />
        )}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.cardTitle}>{news.title}</p>
        <p className={styles.cardSnippet}>{news.body}</p>
        <p className={styles.cardDate}>{formatInstantDate(news.createdAt)}</p>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.editBtn} aria-label={`Edit ${news.title}`} onClick={onEdit}>
          <Pencil size={15} aria-hidden />
        </button>
        <button type="button" className={styles.deleteBtn} aria-label={`Delete ${news.title}`} onClick={onDelete}>
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Guarded hard-delete confirm — mirrors PackageDeleteConfirm's shape. */
function NewsDeleteConfirm({ news, onClose }: { news: NewsItem; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setError(null);
    setBusy(true);
    const res = await deleteNews(news.id);
    setBusy(false);
    if (res.ok) onClose();
    else setError(DELETE_ERROR_TEXT[res.reason] ?? 'Could not delete the news item.');
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Announcements"
      title={`Delete ${news.title}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" icon={Trash2} onClick={() => void onDelete()} disabled={busy}>
            Delete news
          </Button>
        </>
      }
    >
      <div className={styles.confirm}>
        <p className={styles.confirmLead}>
          This permanently deletes the news item and any players' "seen" record for it. Players who already
          received a push notification for it keep that notification in their history — only its link back
          to this item goes stale.
        </p>
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
