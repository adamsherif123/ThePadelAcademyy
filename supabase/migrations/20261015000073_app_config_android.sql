-- ============================================================================
-- S-073 — app_config gets the Android version fields, so the FIRST Android
-- build can be force-updated.
--
-- iOS 1.2 and 1.3 shipped without a working gate and can never be retired. The
-- Android app has not shipped at all yet, which is the one moment this is free:
-- every Android binary ever published will read these two columns, so every one
-- of them can be nudged (latest) or locked out (min_supported).
--
-- ── why separate columns and not "the" version ──
-- The two stores release on their own clocks. A build can be live on the App
-- Store while the same version is still in Play review, or the reverse, and a
-- single shared field would nag one platform about a version it cannot install.
-- The store version strings also only happen to agree today.
--
-- ── both nullable, both shipped NULL ──
-- latest_android_version null  → the soft prompt never shows on Android.
-- min_supported_android_version null → no floor; the hard gate renders nothing.
-- This migration changes no behaviour on its own; turning either on is a value
-- edit, done out of band like the iOS fields (045), after the build that a floor
-- would send people to is actually live on Play.
--
-- ── grants, mirroring 058/059 ──
-- authenticated: holds TABLE-level select (059), which covers new columns, so the
--   soft prompt's `select *` sees them with no grant here. Nothing to add.
-- anon: holds only the column grant on the two iOS fields. A new column is
--   private to anon until someone opts it in — that was 058's design — so the two
--   Android fields are granted explicitly, and nothing else. The hard gate reads
--   the floor signed out, on the sign-in screen, where it matters most.
-- No write grant for anyone; no INSERT/UPDATE/DELETE policy exists (045).
--
-- ── safe for the shipped apps ──
-- Additive, nullable columns. iOS 1.2/1.3/1.4 read app_config with `select *`
-- as authenticated and map by name, so two unknown columns are ignored; the anon
-- read names its two iOS columns and is untouched. No value they read changes.
-- ============================================================================

alter table public.app_config
  add column if not exists latest_android_version        text,
  add column if not exists min_supported_android_version text;

comment on column public.app_config.latest_android_version is
  'versionName of the newest build live on Google Play, e.g. ''1.4''. Null = no update prompt on Android.';
comment on column public.app_config.min_supported_android_version is
  'Oldest Android versionName that may still run. Builds below it are hard-blocked. Null = no floor.';

-- The Android gate runs signed out too. Exactly these two columns.
grant select (latest_android_version, min_supported_android_version)
  on public.app_config to anon;

-- ── assert what we just did ──────────────────────────────────────────────────
do $$
begin
  if not has_column_privilege('anon', 'public.app_config', 'min_supported_android_version', 'select')
     or not has_column_privilege('anon', 'public.app_config', 'latest_android_version', 'select') then
    raise exception '073: anon cannot read the Android version fields';
  end if;
  if has_table_privilege('anon', 'public.app_config', 'select') then
    raise exception '073: anon holds table-wide select on app_config — 059''s column grant is no longer the enforcement';
  end if;
  if has_column_privilege('anon', 'public.app_config', 'updated_at', 'select') then
    raise exception '073: anon can read updated_at';
  end if;
  if has_table_privilege('anon', 'public.app_config', 'insert')
     or has_table_privilege('anon', 'public.app_config', 'update')
     or has_table_privilege('anon', 'public.app_config', 'delete')
     or has_table_privilege('authenticated', 'public.app_config', 'update') then
    raise exception '073: a client role holds a write grant on app_config';
  end if;
  if not has_column_privilege('authenticated', 'public.app_config', 'min_supported_android_version', 'select') then
    raise exception '073: authenticated cannot read the Android floor';
  end if;
  if exists (select 1 from public.app_config
              where latest_android_version is not null or min_supported_android_version is not null) then
    raise exception '073: the Android fields must ship null';
  end if;
end $$;
