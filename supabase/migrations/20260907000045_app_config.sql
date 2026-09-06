-- ============================================================================
-- app_config — the one row the client reads to answer "is this app out of date?"
--
-- ── why a config row rather than the App Store lookup API ──
-- The alternative is querying https://itunes.apple.com/lookup on every launch.
-- That's always accurate with no backend, but it puts a third-party HTTP call on
-- the startup path of an app that otherwise talks only to Supabase — a new failure
-- mode, a new latency source, and no way to control the rollout. This row is read
-- through the same authenticated Supabase client and the same React Query cache as
-- everything else, so its offline behaviour is already solved (no data → the prompt
-- simply doesn't show), and the academy can start or stop nudging by editing one
-- value, with no build and no App Store round trip.
--
-- ── single row, mirroring tpa.push_config ──
-- Same shape the codebase already uses for singleton config (20260727000014):
-- `id int primary key default 1 check (id = 1)`, so there is structurally exactly
-- one row and a reader never has to pick. Unlike push_config (private, tpa schema,
-- server-only) this one is in `public` and READ by the client, so it carries RLS.
--
-- ── min_supported_ios_version is deliberately unread today ──
-- Nothing in the client looks at it yet; it exists so a future MANDATORY update
-- gate ("this version can no longer be used") is a client change plus a value
-- edit, not another migration. Nullable, so leaving it null means "no floor".
--
-- ── writes are out-of-band ──
-- No client, admin or player, may write here — there is no INSERT/UPDATE policy
-- and no RPC. The academy bumps latest_ios_version from the Supabase dashboard or
-- psql, the same out-of-band path scripts/set-admin-credential.mjs uses for the
-- other thing no app is allowed to do.
-- ============================================================================

create table public.app_config (
  id                        int primary key default 1 check (id = 1),
  -- CFBundleShortVersionString of the newest build live on the App Store, e.g.
  -- '1.0.1'. Compared with semver ordering client-side, never string equality.
  latest_ios_version        text not null,
  -- Reserved for a future hard gate. Nothing reads it yet; null = no floor.
  min_supported_ios_version text,
  updated_at                timestamptz not null default now()
);

-- Seeded to the version being submitted now, so nobody on the current build is
-- told they're behind. Bump this AFTER a new version is live on the App Store.
insert into public.app_config (id, latest_ios_version, min_supported_ios_version)
values (1, '1.0.1', null);

alter table public.app_config enable row level security;

-- Every signed-in user reads it; the prompt only ever renders for a ready session.
create policy app_config_select_authenticated on public.app_config
  for select to authenticated
  using (true);

-- Read-only to the API. No insert/update/delete policy exists, so PostgREST
-- refuses those for every client role regardless of grants.
grant select on public.app_config to authenticated;
