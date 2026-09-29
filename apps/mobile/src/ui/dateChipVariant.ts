// The DateChip's one appearance decision, in a module with no react-native
// import so it can be tested. See dateChipVariant.test.ts.

export type DateChipVariant = 'closed' | 'selected' | 'open';

/**
 * ONE decision, which the fill and the text both read.
 *
 * They used to be decided separately: the fill asked `closed` first, the text
 * asked `selected` first, and the two disagreed for a chip that was both. A
 * closed day therefore kept its pale fill while its text turned white — an
 * invisible day number in light mode.
 *
 * That combination is reachable: the Book screen falls back to `days[0]` when no
 * day is open, so on a week the academy is shut the selected day IS a closed one.
 *
 * Closed wins, because it is the truer statement — a day you cannot book is not
 * a day you have chosen, whatever the strip had to fall back to.
 */
export function dateChipVariant(selected: boolean, closed: boolean): DateChipVariant {
  return closed ? 'closed' : selected ? 'selected' : 'open';
}
