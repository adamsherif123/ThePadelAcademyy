import { Image } from 'react-native';

// The real academy badge as a clean transparent circular PNG (brand-badge.png, extracted
// from the source logo in B3). This dropped the old hack: the previous asset was a JPEG on a
// light-grey backdrop with no transparency, so BrandMark had to clip to a circle and
// over-scale 1.5× to crop the grey margins. The transparent badge renders directly at any size.
const BADGE = require('../../assets/images/brand-badge.png');

/** The circular brand badge. */
export function BrandMark({ size = 72 }: { size?: number }) {
  return <Image source={BADGE} style={{ width: size, height: size }} resizeMode="contain" />;
}
