import type { News } from '@tpa/types';
import { Linking } from 'react-native';

import { Button } from './Button';

/**
 * A news post's optional call-to-action, rendered wherever a post is shown — the
 * feed and the launch pop-up — so the two can never disagree about whether a post
 * has a button.
 *
 * Nothing renders without a URL, which is the common case: a post is plain text
 * unless the admin deliberately gave it a link.
 *
 * The label falls back rather than showing the raw address. The URL is the target,
 * not the copy — "https://apps.apple.com/…" is not something to put on a button —
 * and defaulting here rather than in the migration means the wording can change
 * without touching stored rows.
 *
 * openURL is fire-and-forget with the rejection swallowed, the same as Contact us:
 * the scheme is constrained to http(s) by a CHECK on the table, but a device with
 * no browser, or a URL the OS declines, must not take the screen down with it.
 */
export function NewsLinkButton({ news }: { news: News }) {
  const url = news.linkUrl ?? null;
  if (!url) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      fullWidth={false}
      icon="open-outline"
      label={news.linkLabel?.trim() || 'Learn more'}
      onPress={() => {
        void Linking.openURL(url).catch(() => {});
      }}
    />
  );
}
