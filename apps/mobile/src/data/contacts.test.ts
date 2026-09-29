import type { Coach, CoachId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { contactsWithPhotos } from './contacts';

const coach = (name: string, photoUrl: string | null = null): Coach =>
  ({ id: `co_${name.replace(/\s+/g, '')}` as CoachId, name, bio: 'b', photoUrl, isActive: true }) as Coach;

const CONTACTS = [
  { name: 'Aly Salem', display: '01003487025', e164: '+201003487025' },
  { name: 'Mohamed Elgaby', display: '01010083464', e164: '+201010083464' },
];

describe('contactsWithPhotos', () => {
  it('finds each contact’s photo in the coaches table', () => {
    const coaches = [coach('Aly Salem', 'https://x/aly.jpg'), coach('Mohamed Elgaby', 'https://x/m.jpg')];
    expect(contactsWithPhotos(CONTACTS, coaches).map((c) => c.photoUrl)).toEqual([
      'https://x/aly.jpg',
      'https://x/m.jpg',
    ]);
  });

  it('keeps the name and both number forms untouched', () => {
    const [first] = contactsWithPhotos(CONTACTS, [coach('Aly Salem', 'https://x/aly.jpg')]);
    expect(first).toEqual({
      name: 'Aly Salem',
      display: '01003487025',
      e164: '+201003487025',
      photoUrl: 'https://x/aly.jpg',
    });
  });

  // The whole thing has to degrade to what the screen did before photos existed:
  // null, and Avatar draws initials. It must never drop a contact.
  it('yields null rather than dropping a contact with no coach row', () => {
    const out = contactsWithPhotos(CONTACTS, [coach('Aly Salem', 'https://x/aly.jpg')]);
    expect(out).toHaveLength(2);
    expect(out[1]?.photoUrl).toBeNull();
  });

  it('yields null for a coach who has no photo yet', () => {
    expect(contactsWithPhotos(CONTACTS, [coach('Aly Salem', null)])[0]?.photoUrl).toBeNull();
  });

  it('yields null for every contact when no coaches have loaded', () => {
    expect(contactsWithPhotos(CONTACTS, []).every((c) => c.photoUrl === null)).toBe(true);
  });

  // Matching is by name because there is no coach id on a contact and the ids
  // differ between projects. It should survive the ways a name gets typed.
  it('matches regardless of case and extra whitespace', () => {
    const coaches = [coach('  aly   SALEM ', 'https://x/aly.jpg')];
    expect(contactsWithPhotos(CONTACTS, coaches)[0]?.photoUrl).toBe('https://x/aly.jpg');
  });

  it('does not match a different person whose name merely starts the same', () => {
    expect(contactsWithPhotos(CONTACTS, [coach('Aly Salem Hassan', 'https://x/other.jpg')])[0]?.photoUrl).toBeNull();
  });

  it('is empty in, empty out', () => {
    expect(contactsWithPhotos([], [coach('Aly Salem', 'https://x/a.jpg')])).toEqual([]);
  });
});
