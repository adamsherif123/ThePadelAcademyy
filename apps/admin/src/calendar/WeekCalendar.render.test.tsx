import { MOCK_NOW } from '@tpa/mocks';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetStoreForTests } from '../data/store';
import { WeekCalendar } from './WeekCalendar';

/**
 * Structural render coverage for the bug S4c shipped: events were positioned by a
 * full-height invisible `laneWrap` per slot, so only the last-rendered event in a
 * day was clickable (every earlier one sat under a later wrapper). The lane
 * algorithm was pure and tested; the RENDERING of it wasn't, and that's where the
 * bug lived. These assertions lock the structure that caused it.
 */
describe('WeekCalendar rendering', () => {
  beforeEach(() => __resetStoreForTests());

  const html = () =>
    renderToStaticMarkup(
      <WeekCalendar
        now={MOCK_NOW}
        weekOffset={0}
        onPrevWeek={() => {}}
        onNextWeek={() => {}}
        onSlotClick={() => {}}
      />,
    );

  it('renders each event as ONE positioned element carrying BOTH time and lane geometry', () => {
    const markup = html();
    // Every event button's inline style (data-type precedes style on the element).
    const styles = [...markup.matchAll(/data-type="(?:group|duo|individual|trial)"[^>]*?style="([^"]*)"/g)].map(
      (m) => m[1]!,
    );
    expect(styles.length).toBeGreaterThan(0);
    for (const s of styles) {
      // Vertical geometry (from the time) AND horizontal geometry (from the lane)
      // on the SAME element — the split across a wrapper is what broke clicks.
      expect(s).toMatch(/top:/);
      expect(s).toMatch(/height:/);
      expect(s).toMatch(/width:/);
      expect(s).toMatch(/inset-inline-start:/);
    }
  });

  it('has no full-height lane wrapper element', () => {
    // The buggy overlay was class `laneWrap`; it must be gone entirely.
    expect(html()).not.toContain('laneWrap');
  });
});
