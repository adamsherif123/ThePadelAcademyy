# Environments & releases

Production is frozen. `main` is exactly what production serves — nothing lands on it
outside a deliberate release session, where the migrations and the admin bundle move
together.

## The two branches

| branch | what it is | Vercel | Supabase |
| --- | --- | --- | --- |
| `main` | exactly what production serves | Production Branch — a push here deploys the live admin | prod `sxnhkducveyvnzqcnzow` |
| `multi-location` | the work line | pushes build a preview with **no Supabase config** — see below | none; you test locally |

`main` sits at `a157a1d` — the admin as it was before any multi-location work.

## Where you actually test

Locally. Run the admin on `localhost` against the **dev** project:

```bash
pnpm --filter admin dev        # reads apps/admin/.env → vvfkqydglgyzhdtymaus
```

`apps/admin/.env` is gitignored and never reaches a Vercel build, so local and deployed
configuration cannot contaminate each other.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set on Vercel for **Production
only**. A preview build therefore has no Supabase configuration and is not a working
admin — that is deliberate. It is the property that makes a stray push to
`multi-location` harmless.

**Never add Preview or Development environment variables pointing at prod.** A preview
that works is a preview that can write to live data. If a hosted dev admin is ever
wanted, point Preview at the dev project — never at `sxnhkducveyvnzqcnzow`.

## Why this exists

The multi-location build shipped to production every session: migrations went to prod,
and every push to `main` redeployed the live admin through Vercel's git integration.
Twice that broke the live admin — most recently by deploying a bundle that reads
`credit_batches.location_id` while production's schema had no such column, which made
every player show as "Not bookable" in the add-player picker.

The failure was never a bad migration. It was that the client and the schema could move
independently. Coupling them to one branch is the fix.

## Migrations

Migrations go to **dev only** (`supabase db push --linked` with the dev ref) until the
release session. Production stays at `20260926000064`.

`058`–`064` are already on production and are verified harmless to both the
pre-location admin and the 1.2/1.3 mobile clients — they stay. `065` and anything after
it wait on `multi-location`.

**Never run `supabase db push` from `main`.** `main`'s `supabase/migrations` folder stops
at `060`, while production's database has `061`–`064` applied. That gap is expected and
harmless — a push only sends local migrations the remote is missing, and `main` has
none — but the branch is not a truthful picture of prod's schema, so do not use it to
reason about, repair, or pull migration state. All migration work happens on
`multi-location`, which has the full history.

Always `cat supabase/.temp/project-ref` before any Supabase CLI command.

## The release session

One session, in this order:

1. Merge `multi-location` → `main`.
2. `supabase db push` the pending migrations to prod.
3. Push `main`, which deploys the matching admin.
4. Only then `eas build --profile production` for the mobile app.

Migrations first, then the admin, then the app. A client that expects a column must
never reach production before the column does.

Until that session: no `supabase db push` to prod, and no
`eas build --profile production`.

## Mobile

There is no over-the-air update path — `expo-updates` is not installed and nothing in
the repo runs `eas update`. A shipped build can only be changed by another store
release, which is why the mobile app is the last step and never the first.

EAS environment variables (server-side, not in this repo):

| EAS environment | Supabase |
| --- | --- |
| `development` | dev |
| `preview` | dev |
| `production` | prod |
