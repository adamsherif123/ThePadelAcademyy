# Environments & releases

Production is frozen. `main` is exactly what production serves — nothing lands on it
outside a deliberate release session, where the migrations and the admin bundle move
together.

## The two branches

| branch | what it is | Vercel | Supabase |
| --- | --- | --- | --- |
| `main` | exactly what production serves | Production Branch — a push here deploys the live admin | prod `sxnhkducveyvnzqcnzow` |
| `multi-location` | the work line | pushes build a preview with **no Supabase config** — see below | none; you test locally |

`main` sits at the multi-location release, live since 2026-09-30. It sat at `a157a1d`
— the admin as it was before any multi-location work — for the whole of that build.
Naming the current hash here only invites it to go stale; `git log main` is the truth.

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

Migrations go to **dev only** (`supabase db push --linked` with the dev ref) until a
release session. Production is at `20260928000071`: `065`–`071` went up on 2026-09-30
with the 1.4 release. Anything written after that waits on `multi-location` until the
next one.

Since the 1.4 release `main` carries the full migration history and is a truthful
picture of prod's schema. That was not true before it: `main` stopped at `060` while
production had `061`–`064` applied, and pointing the CLI at prod from `main` produced
this —

```
$ supabase db push --dry-run --linked        # from main, before 1.4
Remote migration versions not found in local migrations directory.
...try repairing the migration history table:
supabase migration repair --status reverted 20260926000061 ... 20260926000065
```

It failed safe, nothing was written. Recorded here because the shape recurs: **any time
a branch's `migrations` folder is behind the remote, the CLI offers that repair, and
against prod it is wrong.** It marks migrations as reverted while the schema still has
them, so the next real push tries to apply them again. Only run it on a branch that is
genuinely behind — never to make a deliberate gap go quiet.

Migration work still happens on `multi-location`. `main` moves only in a release
session, and only as a fast-forward, so the two cannot disagree about what prod has.

Always `cat supabase/.temp/project-ref` before any Supabase CLI command.

## Grants on production are not what the local stack shows

Production carries the old hosted-Supabase default privileges:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
```

The current local stack image does not set those for `postgres`. So **a new function
created in `public` on production is executable by `anon` the moment it exists**, while
the same function after a local `supabase db reset` is not. A grant check that passes
locally proves nothing about production.

Two rules follow:

1. Every new function in `public` must `revoke all on function … from public, anon,
   authenticated;` immediately after its `create`, and then grant only the role that
   should hold it. `create or replace` keeps the existing function's ACL, so only
   genuinely new functions need this — but a changed signature is a new function.
2. Grants are verified **on production**, or on a database restored from a production
   dump — never only on the local stack.

`service_role` arrives through the same default and those revokes do not name it. That
is accepted: `service_role` is the server-side key and already bypasses RLS. Name it in
the revoke when a function must not be reachable even from the server side.

`065`–`071` follow this, and it was checked on prod after the push: `anon` holds
execute on none of the functions they introduced.

## The `fill_default_location` triggers stay

`062` put `session_slots_fill_location`, `availability_templates_fill_location` and
`packages_fill_location` on those three tables; `064` made the function they call
SECURITY DEFINER. They look like backfill scaffolding left behind. They are not.

They are what lets a client that knows nothing about branches still write a row: an
insert with no `location_id` gets the default branch instead of failing the NOT NULL.
The pre-location admin depended on that, and the shipped 1.2 and 1.3 mobile apps still
do — neither can ever be updated, because there is no OTA path. Drop the triggers and
every one of those inserts starts failing.

They may only go once nothing that omits `location_id` can still reach production, which
means after 1.2 and 1.3 are out of use. Until then they are load-bearing. **Do not drop
them.**

**And do not edit `062` or `064` to say so** — they are applied migrations, and
rewriting applied history is how the files and the schema stop agreeing. This note is
the record.

## The refund feature, removed

`067` and `068` built a refund queue: money a card gateway had captured that could
not be turned into credits, an RPC to mark it repaid, an admin page, and two owner
alerts. `071` removes all of it.

It could never fire. There is no Paymob integration in this release, and every
other route to credits — a credit request an admin approves, an admin grant, a
recorded cash purchase — takes the money and issues the credits in one action, so
there is no state where the academy holds money it owes back.

`071` restores `settle_purchase`, `fail_purchase` and `set_purchase_paid` to their
pre-`067` definitions byte-for-byte, drops `mark_purchase_refunded` and the two
`purchases` columns, and refuses to run if any row actually carries one. Credit
transfers (`067`), the transfer notification on `credits_granted` (`068`) and the
`066` trial-checkout policy are untouched and asserted so.

That is how it went up on 2026-09-30: `067` and `068` applied in order, then `071`
took the refund parts back out, all in the one push. Nothing was edited retroactively —
the columns exist for three migrations and then do not.

## The release session

One session, in this order:

1. Bump `expo.version` in `apps/mobile/app.json`. The store refuses a build that reuses
   a shipped version, and the bump has to ride the merge — done afterwards it puts a
   commit on `multi-location` that `main` does not have, which is the exact drift this
   file exists to prevent.
2. Merge `multi-location` → `main`.
3. `supabase db push` the pending migrations to prod.
4. Push `main`, which deploys the matching admin.
5. Only then `eas build --profile production` for the mobile app.

Migrations first, then the admin, then the app. A client that expects a column must
never reach production before the column does.

Outside a release session: no `supabase db push` to prod, and no
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
