-- ============================================================================
-- app_config: clear Supabase's default grants, so 058's column grant is real.
--
-- 058 added a COLUMN grant on (latest_ios_version, min_supported_ios_version) to
-- anon and claimed it was the enforcement. Probing the live dev project showed it
-- was not: anon could already `select *`, read updated_at, and held INSERT/UPDATE/
-- DELETE on this table, with nothing but RLS standing between it and a write.
--
-- ── how the gap got there ──
-- 20260716000002_rls.sql:62 does `revoke all on all tables in schema public from
-- anon, authenticated`. That is a one-time statement over the tables that existed
-- when it ran — it is not a standing rule. Supabase's ALTER DEFAULT PRIVILEGES
-- keeps granting anon and authenticated full DML on every table created AFTER it,
-- which is why the later tables each repeat the revoke themselves (admins:36,
-- notifications:46, credit_requests:52, device_push_tokens:78, and the comment on
-- notifications spells out exactly this trap). app_config (045) is the one that
-- did not, so it kept the defaults.
--
-- It stayed invisible because a local `supabase db reset` does not reproduce the
-- platform's default privileges, so the pgTAP added in 058 passed locally while
-- the real projects behaved differently. The test now asserts the write verbs too,
-- but the lesson is that this class of bug is only visible against a real project.
--
-- ── what this changes ──
-- Nothing a legitimate client can do. authenticated keeps `select` on the whole
-- row (the soft update prompt reads `select *`), anon keeps the two version
-- columns, and nobody gains anything. What goes away is the latent write path: the
-- value that can lock every user out of the app was one permissive policy away
-- from being settable by anyone holding the anon key, which ships inside the .ipa.
--
-- Still no INSERT/UPDATE/DELETE policy for any role; the academy edits these
-- values out of band, as 045 intended.
-- ============================================================================

-- Baseline: take everything back, including the platform defaults 045 inherited.
revoke all on public.app_config from anon, authenticated;

-- Then hand back exactly what each role needs, and nothing else.
grant select on public.app_config to authenticated;
grant select (latest_ios_version, min_supported_ios_version)
  on public.app_config to anon;
