import type { Player } from '@tpa/types';

/**
 * Case-insensitive match on a player's name, phone, or email (phone compared with spaces
 * stripped, so "+20 10" and "+2010" both hit). The ONE player-search predicate, shared by
 * the compact PlayerSearch picker and the full Players page — so the two surfaces can never
 * drift into two different notions of "matches". Email search is A2.1 (there's a column now).
 */
export function matchesPlayerQuery(player: Player, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  // phone/email are nullable since A2/A2.1 — treat absent as no match on that field.
  const phone = (player.phone ?? '').replace(/\s+/g, '');
  const email = (player.email ?? '').toLowerCase();
  return (
    player.name.toLowerCase().includes(q) ||
    phone.includes(q.replace(/\s+/g, '')) ||
    email.includes(q)
  );
}
