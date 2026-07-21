# The Padel Academy

Padel-academy management: a client mobile app and an admin web app over a shared
domain core and a Supabase (Postgres) backend.

## Shape

- `apps/mobile` — client app. Expo SDK 56, Expo Router (file-based), TypeScript strict.
- `apps/admin` — admin web app. Vite + React, CSS Modules, TypeScript strict.
- `packages/types` — shared domain types (`@tpa/types`). Type-only, emits zero JS.
- `packages/core` — pure runtime (`@tpa/core`): money/date/time formatting (Africa/Cairo,
  DST-aware), booking & credit rules, id generation, and the domain constants mirrored
  into SQL. No dependencies; runs unchanged in Hermes (RN), the browser, and Deno.
- `packages/mocks` — deterministic fixtures (`@tpa/mocks`) both apps render against.
- `packages/theme` — shared design tokens (`@tpa/theme`): colour, scale, and domain tints.
- `supabase/` — the backend. `migrations/` is the schema: tables with CHECK / exclusion
  constraints, Row-Level Security, and `SECURITY DEFINER` RPCs for every money mutation
  (book / cancel, admin actions, cash + gateway settlement) plus email/password signup.
  `tests/` holds the proofs (see [Tests](#tests)).

Shared packages are **source-only** TypeScript (no build step); each app's bundler
compiles them directly.

> **The apps still render mocks.** `@tpa/mocks` is the app data layer today; wiring the
> apps to Supabase is S9 (mobile) / S10 (admin). Until then the backend is built and
> proven independently by the suites below.

## Requirements

- Node 24 (pinned in `.nvmrc`; `fnm use` on entry — add `eval "$(fnm env --use-on-cd)"` to your shell).
- pnpm 11+
- Docker + the [Supabase CLI](https://supabase.com/docs/guides/local-development) — for the backend.
- Expo Go on a physical device — for mobile.

## Install

```bash
pnpm install
```

## Run the apps

```bash
pnpm mobile          # Expo dev server — scan the QR with Expo Go (iOS: Camera app)
pnpm admin           # Vite dev server — http://localhost:5173
```

Mobile: the phone and this computer must share a Wi-Fi network. If the QR won't
connect, force a relay tunnel: `pnpm --filter mobile start --tunnel`.

## The local backend (Supabase)

```bash
supabase start       # boot Postgres + Auth + REST in Docker, applying all migrations
supabase db reset    # rebuild the database from migrations, from empty
supabase stop        # tear the stack down
```

The database is fully reproducible from `supabase/migrations` — there is no seed data.
Auth is email + password (A2 — phone OTP and Twilio removed); email confirmation is off
for dev (`[auth.email].enable_confirmations = false`), so a fresh signup can use the
account immediately with no SMTP.

## Tests

The unit tests run anytime. The backend suites need `supabase start` first and fail with
a clear message if the stack isn't up.

```bash
pnpm test             # vitest: @tpa/core logic, the zero-JS-emit guard, SQL⇄TS constant parity
pnpm test:db          # pgTAP: RLS isolation, every constraint, every RPC (179 assertions)
pnpm test:concurrency # real N-connection races against the RPCs
pnpm test:auth        # a real email/password session, end to end (incl. the admin refusal)
pnpm verify           # everything above (typecheck + lint + all four suites)
```

What each backend suite proves:

- **`test:db`** — a player can't read another's wallet; a group slot rejects the wrong
  gender/level; a comp requires a written reason; a webhook delivered twice mints once;
  a client can't insert a booking, a succeeded purchase, or a credit batch directly.
- **`test:concurrency`** — a capacity-N court never oversells and a one-credit player
  never books twice under real parallel connections; a booking racing a session
  cancellation is never orphaned; concurrent cancellations never deadlock.
- **`test:auth`** — signing up through the real email/password API grants the two trial
  credits, `book_slot` works, wallet reads are isolated per player, a double signup is
  idempotent, an authenticated user without a completed profile is denied everywhere, and
  an admin credential is refused in the consumer flow (is_admin, no player — bug #2).

## Other checks

```bash
pnpm typecheck                        # tsc across all packages + apps
pnpm lint                             # eslint across both apps
pnpm --filter mobile exec expo-doctor
```

## Adding dependencies

In `apps/mobile`, install native/Expo deps through the Expo CLI so versions match the
SDK — never `pnpm add` them directly:

```bash
pnpm --filter mobile exec expo install <package>
```
