import type { NewsId } from '@tpa/types';

import {
  createNewsRpc,
  type NewsNotifyTarget,
  deleteNewsRpc,
  updateNewsRpc,
  type CreateNewsResult,
  type DeleteNewsResult,
  type UpdateNewsResult,
} from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/** The news CRUD seam — mirrors packages.ts's shape. fetchNews (lib/api.ts) already
 *  orders newest-first, so there's no selector layer here beyond the writes. */

/**
 * Create a news item; the RPC fans out one news_published push to the chosen audience
 * to every active player. Title/body are required — validated server-side
 * (create_news), so a network-level rejection is the only client-side reason.
 */
export function createNews(
  title: string,
  body: string,
  imagePath: string | null,
  notifyTarget: NewsNotifyTarget,
  link: { url: string | null; label: string | null },
): Promise<CreateNewsResult | { ok: false; reason: 'network' }> {
  return runRpc(() => createNewsRpc(title, body, imagePath, notifyTarget, link), TOUCHED.news);
}

/** Edit title/body/image/link — never re-notifies (only create does). */
export function updateNews(
  id: NewsId,
  title: string,
  body: string,
  imagePath: string | null,
  link: { url: string | null; label: string | null },
): Promise<UpdateNewsResult | { ok: false; reason: 'network' }> {
  return runRpc(() => updateNewsRpc(id, title, body, imagePath, link), TOUCHED.news);
}

/** Hard-delete — cascades news_seen, sets notifications.news_id null. */
export function deleteNews(id: NewsId): Promise<DeleteNewsResult | { ok: false; reason: 'network' }> {
  return runRpc(() => deleteNewsRpc(id), TOUCHED.news);
}
