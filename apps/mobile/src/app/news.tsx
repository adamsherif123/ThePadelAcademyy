import Ionicons from '@expo/vector-icons/Ionicons';
import { formatInstantDate } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { News } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { newsImagePublicUrl } from '../lib/api';
import { useMarkNewsSeen, useNews, useNewsSeen } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { shadow } from '../theme/shadow';
import { useTheme } from '../theme/ThemeProvider';
import { EmptyState, ErrorView, LoadingView, Screen, ScreenHeader, Text } from '../ui';

/**
 * The news feed — the academy's shopfront for announcements: every visible item
 * (within the window; see @tpa/core's NEWS_VISIBILITY_DAYS), newest first, full
 * image/title/body inline (no "read more" — these are short, plain-text posts).
 *
 * Opening the feed marks every CURRENTLY VISIBLE item seen, not per-row-on-view —
 * the player has now had the chance to see everything on screen (this IS the "see
 * all news" surface), so there is no reason to make them scroll past each item
 * individually to clear it. Mirrors notifications.tsx's own "opening marks
 * everything read" choice for the same reason. Marked once per mount (a ref
 * guard), the same shape as that screen's read-marking effect.
 */
export default function NewsScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const newsQ = useNews(now);
  const seenQ = useNewsSeen();
  const { mutate: markSeen } = useMarkNewsSeen();

  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || !player || !newsQ.data || !seenQ.data) return;
    marked.current = true;
    const seenIds = new Set(seenQ.data.map((s) => s.newsId));
    const unseenIds = newsQ.data.filter((n) => !seenIds.has(n.id)).map((n) => n.id);
    if (unseenIds.length > 0) markSeen({ playerId: player.id, newsIds: unseenIds });
  }, [player, newsQ.data, seenQ.data, markSeen]);

  if (!player) return null;

  if (newsQ.isPending || seenQ.isPending || newsQ.isError || seenQ.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="The Padel Academy" title="News" onBack={() => router.back()} />
        {newsQ.isError || seenQ.isError ? (
          <ErrorView onRetry={() => { newsQ.refetch(); seenQ.refetch(); }} />
        ) : (
          <LoadingView />
        )}
      </Screen>
    );
  }

  const news = newsQ.data ?? [];

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="The Padel Academy" title="News" onBack={() => router.back()} />

      {news.length === 0 ? (
        <EmptyState icon="newspaper-outline" title="No news yet" message="Announcements from the academy will show up here." />
      ) : (
        news.map((n) => <NewsItemCard key={n.id} news={n} />)
      )}
    </Screen>
  );
}

/** The square-image variant of Card's own surface styling — Card itself always
 *  pads its children, which would inset a top image; this clips it edge-to-edge
 *  instead, then pads only the text block below. */
function NewsItemCard({ news }: { news: News }) {
  const { color } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const imagePath = imageFailed ? null : news.imagePath;
  const styles = useMemo(
    () => StyleSheet.create({
      card: {
        borderWidth: 1,
        borderRadius: radius.lg,
        borderColor: color.border.subtle,
        backgroundColor: color.bg.surface,
        overflow: 'hidden',
      },
      image: { width: '100%', aspectRatio: 1, backgroundColor: color.bg.canvas },
      placeholder: { width: '100%', aspectRatio: 1, backgroundColor: color.bg.canvas, alignItems: 'center', justifyContent: 'center' },
      body: { padding: space.lg, gap: space.xs },
      date: { marginTop: 2 },
    }),
    [color],
  );

  return (
    <View style={[styles.card, shadow('card')]}>
      {imagePath ? (
        <Image
          source={{ uri: newsImagePublicUrl(imagePath) }}
          style={styles.image}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.placeholder}>
          <Ionicons name="newspaper-outline" size={32} color={color.text.muted} />
        </View>
      )}
      <View style={styles.body}>
        <Text variant="h2">{news.title}</Text>
        <Text variant="bodySecondary">{news.body}</Text>
        <Text variant="caption" tone="muted" style={styles.date}>
          {formatInstantDate(news.createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
});
