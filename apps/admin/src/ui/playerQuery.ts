import type { Player } from '@tpa/types';

/**
 * Case-insensitive match on a player's name or phone (phone compared with spaces
 * stripped, so "+20 10" and "+2010" both hit). The ONE player-search predicate,
 * shared by the compact PlayerSearch picker and the full Players page — so the two
 * surfaces can never drift into two different notions of "matches".
 */
export function matchesPlayerQuery(player: Player, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const phone = player.phone.replace(/\s+/g, '');
  return player.name.toLowerCase().includes(q) || phone.includes(q.replace(/\s+/g, ''));
}
