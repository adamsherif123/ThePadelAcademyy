import { describe, expect, it } from 'vitest';

import { dateChipVariant } from './dateChipVariant';

/**
 * The bug: the chip's FILL asked `closed` first and its TEXT asked `selected`
 * first. A day that was both kept the pale closed fill and took the white
 * inverse text, so in light mode the day number was white on near-white.
 *
 * The fix is not a third branch — it is that both now read this one function, so
 * they cannot disagree. These cases pin the precedence that makes that safe.
 */
describe('dateChipVariant — closed beats selected', () => {
  it('a closed day is closed, even when it is the selected one', () => {
    expect(dateChipVariant(true, true)).toBe('closed');
  });

  it('a closed day is closed when it is not selected', () => {
    expect(dateChipVariant(false, true)).toBe('closed');
  });

  it('an open selected day is selected', () => {
    expect(dateChipVariant(true, false)).toBe('selected');
  });

  it('an open unselected day is open', () => {
    expect(dateChipVariant(false, false)).toBe('open');
  });

  // The whole truth table, stated once: `closed` alone decides whether the chip
  // is 'closed', so no combination can produce the light-fill/white-text pair.
  it('never answers "selected" for a closed day, in any combination', () => {
    for (const selected of [true, false]) {
      expect(dateChipVariant(selected, true)).not.toBe('selected');
    }
  });
});
