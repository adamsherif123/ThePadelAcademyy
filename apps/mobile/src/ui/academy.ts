// Brand facts, with NO react-native import, so pure modules (slotLocation) and
// their node-environment tests can reach them without pulling in a component.
/** The academy's real location + hours. Brand facts, not mock data. */
export const ACADEMY = {
  name: 'Oro Plaza Hotel',
  address: 'In front of Family Park, Cairo',
  /** The canonical one-line location shown on session cards — the ONE source. */
  locationLine: 'Oro Plaza Hotel · Cairo',
  /** Deep link to Maps — the location line taps through here before a session. */
  mapsUrl: 'https://maps.google.com/?q=Oro+Plaza+Hotel+Rehab+Cairo',
  hours: 'Sun – Wed · 5:00 PM – 11:00 PM',
  /**
   * The two people who answer for the academy (Profile → Contact us). Kept here with
   * the rest of the brand facts so there's ONE place to change a number, rather than
   * a screen holding its own copy.
   *
   * `display` is how the number is read locally; `e164` is what tel: and wa.me need.
   * (Aly's number is also the InstaPay destination in request-credits — deliberately
   * NOT shared with this list: one is a payment address, the other a contact, and
   * they're free to diverge.)
   */
  contacts: [
    { name: 'Aly Salem', display: '01003487025', e164: '+201003487025' },
    { name: 'Mohamed Elgaby', display: '01010083464', e164: '+201010083464' },
  ],
} as const;
