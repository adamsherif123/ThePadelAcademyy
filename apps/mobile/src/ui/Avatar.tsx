import { color } from '@tpa/theme';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from './Text';

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Navy circle with initials, or a circular photo when `imageUrl` is set (coach
 * photos). Falls back to initials when there is no url AND when the image fails
 * to load (onError) — a blank circle is never acceptable, initials always are.
 * Production photos come from Supabase Storage and will sometimes 404/time out.
 */
export function Avatar({
  name,
  imageUrl,
  size = 44,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dimension = { width: size, height: size, borderRadius: size / 2 };

  if (imageUrl && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        onError={() => setFailed(true)}
        style={[styles.image, dimension]}
      />
    );
  }
  return (
    <View style={[styles.circle, dimension]}>
      <Text variant="body" weight="bold" tone="inverse" style={{ fontSize: size * 0.4 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: color.bg.inverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { backgroundColor: color.bg.canvas },
});
