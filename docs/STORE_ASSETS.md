# Store-submission checklist (updated B4a — production builds exist)

Everything Adam needs to work through App Store Connect and Google Play Console without
guessing. Sizes are current as of the 2025 store requirements — re-confirm at submission time,
as Apple/Google revise device classes.

## Already live / confirmed (nothing to do)

- **Privacy Policy URL**: `https://the-padel-academyy-admin.vercel.app/privacy.html`
- **Account Deletion URL** (Google's separate requirement):
  `https://the-padel-academyy-admin.vercel.app/delete-account.html`
- **Bundle ID / package name**: `com.thepadelacademy.app` (both platforms, confirmed against
  the actual production credentials — Apple Distribution Certificate + App Store Provisioning
  Profile exist for it; Android release keystore exists for it).
- **Version**: `1.0.0`. **Build numbers**: EAS-managed (`appVersionSource: "remote"` +
  `autoIncrement: true` in eas.json) — iOS buildNumber and Android versionCode auto-increment
  on every subsequent production build; don't hand-edit them.
- Contact email on the legal pages is currently **adamsherif167@gmail.com** — Adam's personal
  address, standing in until the academy has a real monitored inbox (flagged in both HTML
  files with a TODO comment; search-and-replace when one exists).

## Apple App Store Connect

- **App Store Connect app record**: create it under the Apple Developer team (H9FN44P4K7,
  "Adam Sherif (Individual)") if not already done, bundle ID `com.thepadelacademy.app`.
- **Marketing app icon** — 1024×1024 PNG, flattened/opaque, no alpha, no rounded corners
  (Apple rounds it). Separate from the in-app icon EAS already builds.
- **Screenshots** — captured from the running app, portrait, up to 10 per device class:
  - **6.9" iPhone** (16 Pro Max class): **1320×2868** — required.
  - **6.5" iPhone** (11 Pro Max / XS Max): **1242×2688** — required if 6.9" doesn't cover all.
  - **iPad**: `ios.supportsTablet` is unset in app.json, which Expo defaults to phone-only (no
    iPad target) — confirm this in App Store Connect's device-support settings; if so, no iPad
    screenshots are owed.
- **App preview video** — optional; skip for launch.
- **Text/metadata**: name, subtitle, promotional text, description, keywords, support URL,
  marketing URL (optional), the **Privacy Policy URL** above.
- **App Privacy (nutrition labels)** — declare data collected; see "Data declarations" below.
- **Age rating** questionnaire.
- **Export compliance**: `ITSAppUsesNonExemptEncryption: false` is already set in app.json (no
  extra encryption paperwork needed at submission).
- **Sign in demo account**: since Apple review needs to sign in, either give reviewers a real
  test account (email + password created via the normal signup flow) or note in App Review
  notes how to create one — there's no reviewer-bypass in this app.

## Google Play Console

- **Play Console app record**: create it if not already done, package `com.thepadelacademy.app`.
- **Store listing icon** — 512×512 PNG, 32-bit with alpha (distinct from the in-app adaptive
  icon).
- **Feature graphic** — **1024×500 PNG/JPEG, no alpha, required**. This is a designed banner
  (badge + wordmark/tagline on navy `#06122f`), not just the logo dropped in — needs real
  layout; ask a designer or compose it from `apps/mobile/assets/images/brand-badge.png`.
- **Phone screenshots** — min 2, up to 8, portrait (e.g. 1080×1920), each side 320–3840px.
- **Tablet screenshots** — only if targeting tablets (mirror the iPad decision above).
- **Text/metadata**: short description (≤80 chars), full description (≤4000 chars), the
  **Privacy Policy URL** above.
- **Data safety form** — declare data collected; see "Data declarations" below.
- **Content rating (IARC)** questionnaire.
- **Account deletion**: Play's Data Safety form has an explicit "provide a way to request
  account deletion" field — point it at the **Account Deletion URL** above.
- **App signing**: the release keystore already exists in EAS (Build Credentials `RgGgzUwpFv`).
  If this is the first Play Console upload, enroll in Play App Signing when prompted — Google
  then manages the signing key going forward; EAS's keystore remains the *upload* key.
- **Uploading the build**: `eas submit` is configured to use the same Firebase service-account
  key as FCM push (Adam assigned it this session) — Adam can either run `eas submit --platform
  android` or upload the `.aab` to Play Console manually. Both work; this session didn't run
  either (submission is explicitly out of scope here).

## Data declarations (both stores) — from the actual schema, not guessed

- **Account/profile**: name, email, password (handled by Supabase Auth — never stored in
  readable form by us), optional phone, gender category, skill level, self-reported
  "trained before" flag.
- **Bookings/credits/purchases**: session bookings, attendance, credit balance, purchase
  history.
- **Payment-proof photos**: the credit-request screenshot attachment, stored privately (own
  player + admin only).
- **Push token**: `device_push_tokens`, used only for delivery via Expo → APNs/FCM.
- **Payment processing**: **out-of-band today** (InstaPay/cash, confirmed manually by staff) —
  no card data touches the app. Paymob (a PCI-DSS gateway) is wired but **flagged off** in
  production (confirmed: `EXPO_PUBLIC_PAYMOB_ENABLED` unset in the EAS production
  environment); when enabled it would receive name + a phone number + amount, never the real
  email or a card number.
- **Crash/error diagnostics (Sentry)**: wired but **inactive** — no `SENTRY_DSN` is set in the
  production environment.
- **No data is sold or shared with advertisers.**

This is the same content already written out in full, reader-facing form on the live privacy
page — cross-check the two before submitting so the store forms and the public policy agree.

## Not covered by any existing asset (must create)

1. **Screenshots** — capture from the running production app on real device sizes.
2. **Play feature graphic** (1024×500) — a designed banner, not existing yet.
3. **App Store 1024×1024 marketing icon** — separate from the in-app icon.
4. **Store descriptions/keywords/subtitle** — real marketing copy, not written here.
5. **A reviewer-usable test account** for Apple's sign-in requirement.

## Launch dependency on the academy (not on engineering)

Per the B2 production stand-up: only the trial package is seeded. **Group/duo/individual
packages and real coaches must be entered by the academy through the admin app** before the
store listing's screenshots can show a realistic catalogue, and before real players can do
anything beyond the trial. Whoever does this needs: the hosted admin URL
(`https://the-padel-academyy-admin.vercel.app`) and the admin login (set via
`scripts/set-admin-credential.mjs`, §5 of `apps/admin/ADMIN_ACCESS.md`).

See also `docs/PRODUCTION_CUTOVER.md` for the full pre-launch infrastructure checklist.
