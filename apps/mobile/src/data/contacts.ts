import type { Coach } from '@tpa/types';

/** One of the people who answer for the academy, with their photo if we have one. */
export interface AcademyContact {
  name: string;
  /** How the number reads locally. */
  display: string;
  /** What tel: and wa.me need. */
  e164: string;
  /** From their coaches row, or null — Avatar falls back to initials. */
  photoUrl: string | null;
}

/** Trimmed, collapsed, case-folded — so "Aly  Salem" matches "aly salem". */
const key = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Join the academy's contacts to their coach photos.
 *
 * The two people on the contact sheet own the academy and coach there, so their
 * photographs already exist in `coaches` — uploaded once, in the admin, and kept
 * current there. Reading them here rather than adding a second copy to the brand
 * constants means a coach who changes their photo changes it everywhere, and
 * there is no second place to forget.
 *
 * Matched by NAME, because a contact has no coach id to join on and the ids differ
 * between the dev and production projects, so hard-coding them would work in one
 * and silently fail in the other. A rename in the admin therefore drops the photo
 * — which is why the whole thing degrades rather than breaks: no match, no url,
 * and Avatar shows initials, exactly as it did before there were any photos.
 */
export function contactsWithPhotos(
  contacts: readonly { name: string; display: string; e164: string }[],
  coaches: readonly Coach[],
): AcademyContact[] {
  const byName = new Map(coaches.map((c) => [key(c.name), c]));
  return contacts.map((c) => ({ ...c, photoUrl: byName.get(key(c.name))?.photoUrl ?? null }));
}
