import type { Brand } from './brand';

/**
 * Money is ALWAYS integer piastres. 1 EGP = 100 piastres.
 * Never a float, never a raw `number`. There is exactly one place that turns
 * `Piastres` into a display string: `formatPiastres` in @tpa/core.
 *
 * Storing money as an integer sub-unit avoids IEEE-754 rounding entirely
 * (350.00 EGP is the integer 35000, not the float 350).
 */
export type Piastres = Brand<number, 'Piastres'>;
