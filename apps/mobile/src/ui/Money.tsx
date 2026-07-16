import { formatPiastres } from '@tpa/core';
import type { FontWeightToken } from '@tpa/theme';
import type { Piastres } from '@tpa/types';

import { Text, type TextTone, type TextVariant } from './Text';

/**
 * Renders a money amount. The `amount` prop is typed `Piastres`, and the value is
 * ALWAYS produced by @tpa/core's `formatPiastres` — there is no way to render
 * money here without going through format.ts. Callers pass integer piastres; the
 * EGP string is derived, never hand-built.
 */
export function Money({
  amount,
  variant = 'body',
  tone,
  weight,
}: {
  amount: Piastres;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: FontWeightToken;
}) {
  return (
    <Text variant={variant} tone={tone} weight={weight}>
      {formatPiastres(amount)}
    </Text>
  );
}
