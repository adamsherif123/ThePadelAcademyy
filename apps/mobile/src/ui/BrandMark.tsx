import { color, radius } from '@tpa/theme';
import { Image, StyleSheet, View } from 'react-native';

// The real academy badge. NOTE: the source is a JPEG on a light-gray backdrop with
// no transparency, so we clip to a circle and over-scale to crop the gray margins,
// leaving the blue badge. A clean transparent badge-only asset would remove the
// need for this trick (see the S3a report).
const LOGO = require('../../assets/images/brand-logo.jpg');

/** The circular brand badge, cropped from the source asset. */
export function BrandMark({ size = 72 }: { size?: number }) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={LOGO}
        resizeMode="cover"
        style={{ width: size * 1.5, height: size * 1.5 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg.inverse,
    borderRadius: radius.pill,
  },
});
