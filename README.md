# The Padel Academy

Padel-academy management product.

- `apps/mobile` — client app. Expo SDK 56, Expo Router (file-based), TypeScript strict.
- `apps/admin` — admin web app. Vite + React, TypeScript strict.
- `packages/types` — shared TS types (`@tpa/types`).
- `packages/theme` — shared design tokens (`@tpa/theme`).

Shared packages are **source-only** TypeScript (no build step); each app's bundler
compiles them directly.

## Requirements

- Node >= 22.13 (Expo SDK 56 minimum)
- pnpm 11+
- Expo Go on a physical device (for mobile)

## Install

```bash
pnpm install
```

## Run the mobile app

```bash
pnpm mobile          # or: pnpm --filter mobile start
```

Then scan the QR code with **Expo Go** (Android) or the **Camera app** (iOS).
The phone and this computer must be on the same Wi-Fi network. If the QR does not
connect, force a relay tunnel:

```bash
pnpm --filter mobile start --tunnel
```

## Run the admin app

```bash
pnpm admin           # or: pnpm --filter admin dev
```

Then open http://localhost:5173.

## Checks

```bash
pnpm typecheck                      # tsc across all 4 projects
pnpm lint                           # eslint across both apps
pnpm --filter mobile exec expo-doctor
```

## Adding dependencies

In `apps/mobile`, **always** install native/Expo deps through the Expo CLI so versions
match the SDK. Never `pnpm add` them directly.

```bash
pnpm --filter mobile exec expo install <package>
```

## Conventions enforced by lint (mobile)

These are warnings today; they exist so later sessions don't have to retrofit.

- No inline hex colors — colors come from `@tpa/theme`.
- No physical layout props (`marginLeft`, `paddingRight`, `left`, `right`, …) — use the
  logical `start`/`end` equivalents so a later Arabic/RTL pass is free.
- No raw `<Text>` from `react-native` — a shared `<Text>` component is coming.
