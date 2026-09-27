import Constants from 'expo-constants';

import { clientHeaderValue } from './clientHeader';

/**
 * The installed app version — the SAME source the update gate reads.
 *
 * `Constants.expoConfig.version` is app.json's `version` baked in at build time,
 * which IS CFBundleShortVersionString for this project (no expo-updates, so the
 * manifest can never disagree with the binary — see UpdatePromptBridge). Sharing
 * it means a build can never be "new enough to see the second branch" and "old
 * enough to be nagged to update" at the same time.
 *
 * It is also present under Expo Go and in a dev build, because expoConfig is read
 * from the same app.json in every mode — so the header is not a
 * release-build-only behaviour that first appears in TestFlight.
 */
export const APP_VERSION: string | undefined = Constants.expoConfig?.version;

/** The `x-tpa-client` value for this build, or undefined if the version is unusable. */
export const CLIENT_HEADER: string | undefined = clientHeaderValue(APP_VERSION);
