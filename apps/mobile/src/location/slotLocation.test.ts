import type { Location, LocationId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { ACADEMY } from '../ui/academy';
import { placeFor } from './slotLocation';

const loc = (id: string, name: string, address: string): Location =>
  ({
    id: id as LocationId,
    name,
    address,
    mapsUrl: `https://maps.google.com/?q=${id}`,
    hoursText: 'Sun – Wed · 5:00 PM – 11:00 PM',
    isActive: true,
    isDefault: false,
  }) as Location;

const ORO = loc('loc_oro', 'Oro Plaza Hotel', 'In front of Family Park, Cairo');
const QA = loc('loc_qa', 'S7 QA Branch', '12 Test Street, Giza');

describe('placeFor — a session shows ITS OWN branch, never the toggle', () => {
  it('returns the slot’s branch even when it is not the first in the list', () => {
    const place = placeFor(QA.id, [ORO, QA]);
    expect(place.name).toBe('S7 QA Branch');
    expect(place.line).toBe('S7 QA Branch · 12 Test Street, Giza');
    expect(place.mapsUrl).toBe(QA.mapsUrl);
  });

  // The failure this guards against is a player driving to the wrong address:
  // two branches, a booking at the second, and nothing in placeFor's inputs
  // says which one is "selected" — because it must not.
  it('does not depend on ordering: swapping the list changes nothing', () => {
    expect(placeFor(QA.id, [ORO, QA])).toEqual(placeFor(QA.id, [QA, ORO]));
  });

  it('falls back to the main club before locations load', () => {
    const place = placeFor(ORO.id, []);
    expect(place.name).toBe(ACADEMY.name);
    expect(place.line).toBe(`${ACADEMY.name} · ${ACADEMY.address}`);
    expect(place.mapsUrl).toBe(ACADEMY.mapsUrl);
  });

  it('falls back for a branch row that is gone, and for a null id', () => {
    expect(placeFor('loc_deleted' as LocationId, [ORO, QA]).name).toBe(ACADEMY.name);
    expect(placeFor(null, [ORO, QA]).name).toBe(ACADEMY.name);
    expect(placeFor(undefined, [ORO, QA]).name).toBe(ACADEMY.name);
  });

  // The fallback and the loaded row must render IDENTICALLY for the main club,
  // or a card visibly rewrites itself the moment locations arrive.
  it('the fallback line equals what the loaded main-branch row produces', () => {
    const main = loc('loc_main', ACADEMY.name, ACADEMY.address);
    expect(placeFor(main.id, [main]).line).toBe(placeFor(null, []).line);
  });
});
