import Ionicons from '@expo/vector-icons/Ionicons';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { newsImagePublicUrl } from '../lib/api';
import { useMarkNewsSeen, useUnseenNews } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Screen, Text } from '../ui';

/**
 * The unseen-news pop-up — the newest unseen item, presented first thing on a
 * cold start / foreground (see NewsPopupBridge, which decides WHEN to navigate
 * here; this screen only decides WHAT to show once it's already open). Every
 * dismiss path (X, "Got it", "See all news") marks the item seen, so by
 * construction it can only ever show a given item once — the "keeps appearing
 * until seen" behavior falls out of that automatically: it's only still unseen
 * (and so still poppable) if the player left without tapping anything (e.g. a
 * hardware back gesture), which is exactly the case it SHOULD reappear for.
 *
 * Self-contained: it re-derives "the newest unseen item" live rather than
 * trusting a route param, so a race (the item got marked seen elsewhere between
 * the bridge's decision and this screen mounting) self-corrects — if there's
 * nothing left to show, it just closes itself.
 */
export default function NewsPopupScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const unseenQ = useUnseenNews(now);
  const { mutate: markSeen } = useMarkNewsSeen();
  const [imageFailed, setImageFailed] = useState(false);
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
      content: { flex: 1 },
      imageWrap: { width: '100%', aspectRatio: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: color.bg.canvas },
      placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
      body: { gap: space.sm, marginTop: space.lg },
      footer: { gap: space.sm },
    }),
    [color],
  );

  const item = unseenQ.data?.[0];

  // Self-correct: nothing left to show (already marked seen elsewhere, or the
  // player got here in a state that no longer has an unseen item) — close
  // rather than render an empty modal.
  useEffect(() => {
    if (unseenQ.data && !item) router.back();
  }, [unseenQ.data, item, router]);

  if (!player || !item) return null;

  const dismiss = (andThen?: () => void) => {
    markSeen({ playerId: player.id, newsIds: [item.id] });
    if (andThen) andThen();
    else router.back();
  };

  return (
    <Screen
      style={styles.content}
      footer={
        <View style={styles.footer}>
          <Button label="See all news" variant="secondary" onPress={() => dismiss(() => router.replace('/news'))} />
          <Button label="Got it" onPress={() => dismiss()} />
        </View>
      }
    >
      <View style={styles.imageWrap}>
        {item.imagePath && !imageFailed ? (
          <Image
            source={{ uri: newsImagePublicUrl(item.imagePath) }}
            style={StyleSheet.absoluteFill}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="newspaper-outline" size={40} color={color.text.muted} />
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text variant="label">The Padel Academy</Text>
        <Text variant="h1">{item.title}</Text>
        <Text variant="bodySecondary">{item.body}</Text>
      </View>
    </Screen>
  );
}
