/**
 * Prefixes for entity ids. The DB has no default — insert code supplies the id
 * via `newId`. Keyed by entity so callers write `newId(ID_PREFIXES.player)`.
 */
export const ID_PREFIXES = {
  player: 'pl_',
  coach: 'co_',
  package: 'pk_',
  purchase: 'pu_',
  creditBatch: 'cb_',
  slot: 'sl_',
  booking: 'bk_',
  availabilityTemplate: 'at_',
  deviceToken: 'dpt_',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/**
 * Minimal shape of the Web Crypto object we rely on. Declared locally so @tpa/core
 * needs neither the DOM lib nor any dependency, staying runtime-agnostic.
 */
interface MinimalCrypto {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function getCrypto(): MinimalCrypto | undefined {
  return (globalThis as { crypto?: MinimalCrypto }).crypto;
}

function uuidV4(): string {
  const c = getCrypto();

  // Node 20+, Deno, and modern browsers expose randomUUID directly.
  if (c?.randomUUID) return c.randomUUID();

  // React Native (Hermes) has no Web Crypto. The mobile app installs
  // `react-native-get-random-values` at entry, which provides getRandomValues
  // (but NOT randomUUID) — so build a v4 from raw bytes.
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40; // version 4
    b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return (
      hex.slice(0, 4).join('') +
      '-' +
      hex.slice(4, 6).join('') +
      '-' +
      hex.slice(6, 8).join('') +
      '-' +
      hex.slice(8, 10).join('') +
      '-' +
      hex.slice(10, 16).join('')
    );
  }

  throw new Error(
    "newId: Web Crypto is unavailable. In React Native, import 'react-native-get-random-values' at your app entry before generating ids.",
  );
}

/**
 * Generate a fresh prefixed id, e.g. `newId(ID_PREFIXES.player)` -> `pl_9f3a…`.
 * Returns a template-typed string; cast to the specific branded id at the call
 * site (`newId(ID_PREFIXES.player) as PlayerId`).
 */
export function newId<P extends IdPrefix>(prefix: P): `${P}${string}` {
  return `${prefix}${uuidV4()}` as `${P}${string}`;
}
