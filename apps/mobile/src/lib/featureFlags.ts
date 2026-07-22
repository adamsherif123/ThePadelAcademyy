/**
 * Build-time feature flags, read from EXPO_PUBLIC_* env (Expo inlines these into the
 * bundle at build time — same mechanism as the Supabase URL/key). Flipping one is an env
 * change + rebuild, never a code edit — which is exactly what we want for Paymob.
 */

/**
 * Paymob online card checkout. OFF by default (the env var unset ⇒ false): the academy
 * hasn't completed Paymob merchant verification, so credits are bought OUT-OF-BAND (an
 * InstaPay transfer or cash at the desk) and reported through the request-credits flow
 * (A3/A4), which the admin approves.
 *
 * Paymob is MOTHBALLED, not deleted: every piece stays — the checkout + purchase-success
 * screens, the create-checkout / paymob-webhook Edge Functions, settle_purchase, the HMAC
 * verification. Only the wallet's ROUTING into that journey is gated on this flag. When
 * verification lands, set EXPO_PUBLIC_PAYMOB_ENABLED=true and rebuild — no code change.
 */
export const PAYMOB_ENABLED = process.env.EXPO_PUBLIC_PAYMOB_ENABLED === 'true';
