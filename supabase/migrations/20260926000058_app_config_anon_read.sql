-- ============================================================================
-- app_config: let a SIGNED-OUT client read the two version fields.
--
-- The hard update gate has to work before anyone signs in. A binary that can no
-- longer be used must say so on the sign-in screen, not wait for a session it may
-- never get — and the coach shell and the (auth) group both sit outside the
-- authenticated tabs. Today the only policy is app_config_select_authenticated
-- (migration 045), so an anon client reads nothing and the gate would be dead on
-- exactly the screens it most needs to cover.
--
-- ── why a COLUMN grant and not `grant select on app_config` ──
-- anon is the most exposed role in the system: its key ships inside every binary
-- and is readable by anyone who unzips an .ipa. It gets the two fields the gate
-- compares and nothing else. `updated_at` is operational metadata — it would tell
-- an unauthenticated caller when the academy last touched its release config,
-- which is nobody's business and buys the client nothing. `id` is a constant 1.
--
-- A column grant is also self-enforcing in a way a policy is not: `select *` as
-- anon now FAILS rather than quietly widening if a future column is added. Any
-- new column is private by default and someone has to opt it in deliberately.
-- (The client therefore names the two columns; it must not use select *.)
--
-- ── no write path changes ──
-- There is still no INSERT/UPDATE/DELETE policy on this table for any role, so
-- PostgREST refuses writes regardless of grants. The academy edits these values
-- out of band, as 045 intended.
--
-- ── this migration changes NO values ──
-- min_supported_ios_version stays NULL. The gate ships inert: it reads a floor
-- that does not exist yet and renders nothing. Turning it on is a one-value edit,
-- deliberately not bundled with the code that enforces it.
-- ============================================================================

-- The two fields the gate compares, and only those.
grant select (latest_ios_version, min_supported_ios_version)
  on public.app_config to anon;

-- Grants alone are not enough: RLS is enabled on this table, so without a policy
-- for `anon` every row is filtered out and the grant would read as an empty set.
create policy app_config_select_anon on public.app_config
  for select to anon
  using (true);

comment on policy app_config_select_anon on public.app_config is
  'Signed-out read for the hard update gate. Column grant limits it to the two version fields.';
