# Push notifications — build & FCM setup

The notification **code** (permission, token, handlers, in-app centre, tap routing) is
complete and cross-platform. Remote push **does not work in Expo Go** (SDK 53+ dropped
it), so it needs an EAS development build or a store build.

## Where Android stands

| piece | state |
| --- | --- |
| EAS project | linked — `extra.eas.projectId` in `app.json` |
| Firebase project | `tpaandroid-e8c13`, Android app `com.thepadelacademy.app` |
| `google-services.json` | **committed** at `apps/mobile/google-services.json`, wired by `android.googleServicesFile` |
| FCM V1 service-account key | uploaded to EAS credentials (push was proven end to end on the Pixel 7 emulator in July 2026) |
| Android channel | `default` ("Default"), created by `push.ts` before the token is fetched |

### Why `google-services.json` is committed

It is client configuration, not a secret: every value in it ships inside the APK/AAB,
and anyone can read it out of an installed app. EAS uploads only git-tracked files, so
ignoring it made prebuild fail. It is the same for dev and prod builds (one Firebase
project, one Android app).

The **service-account key** is the secret — it lets its holder send pushes as the
academy. It stays gitignored (`apps/mobile/.gitignore`: `*firebase-adminsdk*.json`,
`*service-account*.json`, `*ServiceAccount*.json`) and lives only in EAS credentials.

## Redoing the Firebase setup from scratch

Only needed if the Firebase project or the EAS credential is ever lost.

1. <https://console.firebase.google.com> → **Add project** (Analytics not needed).
2. Project overview → **Add app → Android**. Package name **exactly**
   `com.thepadelacademy.app` (it must equal `expo.android.package` and the Play
   Console package). Nickname optional; skip the SHA-1 (FCM doesn't need it).
3. **Download `google-services.json`** → replace `apps/mobile/google-services.json`
   → commit it. Skip Firebase's "add the SDK" steps — Expo's prebuild does them.
4. Project settings (gear) → **Cloud Messaging** → confirm **Firebase Cloud Messaging
   API (V1)** is *Enabled*. (The legacy API is gone; nothing here uses it.)
5. Project settings → **Service accounts** → **Generate new private key** → save the
   JSON somewhere **outside the repo** (or inside `apps/mobile/` under a name the
   gitignore above matches). Never commit it.
6. Upload it to Expo:
   ```bash
   cd apps/mobile
   eas credentials --platform android
   # → production (or any profile — the push key is per app, not per profile)
   # → Google Service Account
   # → Manage your Google Service Account Key for Push Notifications (FCM V1)
   # → Set up a Google Service Account Key for Push Notifications (FCM V1)
   # → Upload a new service account key → pick the JSON from step 5
   ```
   Check it took: <https://expo.dev> → the project → **Credentials → Android →
   com.thepadelacademy.app → FCM V1 service account key**.
7. Delete the local copy of the key once it is uploaded.

No rebuild is needed after step 6 — the key is used by Expo's push service, not
embedded in the app.

## Channels and taps (Android)

- `ensureAndroidChannel` creates channel `default` (importance DEFAULT) before the
  token is requested — Android 8+ drops a notification whose channel doesn't exist.
  The server sends no `channelId`, and Expo's push service then uses `default`.
- Android 13+ asks for the POST_NOTIFICATIONS runtime permission through the same
  `requestPermissionsAsync` call as iOS (expo-notifications declares it).
- A tap goes through `push.ts` (`addNotificationResponseReceivedListener` warm,
  `getLastNotificationResponseAsync` cold) → `NotificationsBridge` →
  `notificationHref` in `deepLink.ts`, the same mapping the in-app centre uses.

## Prove it (device test)

A **Google Play** emulator image (or a real phone) is required — an image without
Google Play services has no FCM and `getExpoPushTokenAsync` fails gracefully.

- Sign in as the dev player, accept the notification prompt → a row appears in
  `device_push_tokens` with platform `android`.
- Grant credits from the admin (dev) → a banner lands; tap → Wallet.
- Book a duo to 1/2, fill it from the admin → "Session confirmed"; tap → that session.
- Kill the app, trigger another → tap the banner → the app cold-starts on that screen.

## iOS

APNs key in EAS credentials (iOS → Push Key). No source changes.
