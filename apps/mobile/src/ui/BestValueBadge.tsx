import { color } from '@tpa/theme';
import type { Package } from '@tpa/types';

import { Badge } from './Badge';

/** The single "best value" rule: 8-session bundles. Used by both package cards. */
export function isBestValuePackage(pkg: Package): boolean {
  return pkg.sessionCount === 8;
}

/** The single BEST VALUE badge treatment (royal pill) shared by PackageCard/Row. */
export function BestValueBadge() {
  return <Badge label="Best value" tint={{ fg: color.text.inverse, bg: color.accent.default }} />;
}
