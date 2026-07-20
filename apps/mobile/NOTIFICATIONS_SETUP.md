# Push notifications — build & FCM setup

The notification **code** (permission, token, handlers, in-app centre) is complete and
cross-platform. What's left is credentials the AI can't create for you: an EAS project
ID, an Android FCM key, and (later) an iOS APNs key. Remote push **does not work in
Expo Go** (SDK 53+ dropped it), so this needs an **EAS development build**.

## One-time: link the EAS project

```bash
cd apps/mobile
eas login                 # your Expo account
eas init                  # creates the project, writes extra.eas.projectId into app.json
```

`app.json` already has an empty `extra.eas.projectId` slot — `eas init` fills it. Until
it's set, the app runs fine but simply won't fetch a push token (registration no-ops;
the in-app centre still works).

## Android delivery (free — no Apple account needed)

Expo delivers Android pushes through **FCM**. Two steps:

1. **Firebase project** → Add an Android app with package `com.thepadelacademy.app`
   → download **`google-services.json`** into `apps/mobile/`. Then add to `app.json`
   under `"android"`: `"googleServicesFile": "./google-services.json"`.
   (Left out of the committed config so `expo start` / CI don't fail on a missing file.)
2. Give Expo the FCM credential so its push service can deliver:
   ```bash
   eas credentials            # Android → Push Notifications (FCM V1) → upload the
                              # service-account JSON from Firebase console → Project
                              # settings → Service accounts → Generate new private key
   ```

## Build & install the Android dev build

```bash
eas build --platform android --profile development     # ~10-15 min in EAS cloud
# install the resulting .apk on a REAL Android device (not an emulator — no FCM there)
pnpm --filter mobile start   # dev server; open the dev build, it connects
```

Sign in as a real player, accept the notification permission → the app registers the
device token to `device_push_tokens`. Trigger an event (below) and the OS banner lands.

## Prove it (device test)

- Book a duo to 1/2 on device A, then fill it from the admin app (or device B) →
  device A gets a **“Session confirmed”** banner; tap → that session in Sessions.
- Grant credits from the admin → the player's device gets a banner; tap → Wallet.
- The bell badge + centre update in-app whether or not the push was tapped (Realtime).

## iOS (later — credentials only, no code change)

Everything is iOS-ready in code. iOS push needs the **APNs key** from the Apple
Developer account (verification pending). When that's ready:
`eas credentials` → iOS → Push Key → upload, then
`eas build --platform ios --profile development`. No source changes.
