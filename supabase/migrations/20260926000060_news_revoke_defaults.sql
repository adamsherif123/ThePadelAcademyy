-- ============================================================================
-- news / news_seen: clear Supabase's default grants (the 059 fix, applied to the
-- other two tables that have it).
--
-- Both tables carry `GRANT ALL TO anon` and `GRANT ALL TO authenticated` on the
-- live projects — every verb, including DELETE and TRUNCATE — with nothing but
-- RLS standing between the anon key and the academy's entire news feed.
--
-- ── how they got it, and why the existing revoke did not help ──
-- 20260716000002_rls.sql:62 revokes the platform defaults once, over the tables
-- that existed then. news and news_seen came later. Each DID revoke, but from the
-- wrong role: `revoke all on public.news from public` takes back grants held by
-- the PUBLIC pseudo-role, while Supabase's ALTER DEFAULT PRIVILEGES grants to
-- `anon` and `authenticated` by name. So the revoke was a no-op against the
-- grants that actually existed. admins, notifications, credit_requests and
-- device_push_tokens name both roles and are clean.
--
-- ── what each role actually needs ──
-- Read from the live policies, not from intent:
--   news      — news_select_authenticated (true), and insert/update/delete gated
--               on is_admin(). Four verbs, all `to authenticated`.
--   news_seen — news_seen_select_own and news_seen_insert_own. Two verbs.
--   anon      — has NO policy on either table, so every anon grant is dead weight
--               that only RLS is neutralising. It gets nothing.
-- service_role keeps GRANT ALL: the send-push Edge Function and the triggers run
-- as it, and it bypasses RLS by design.
--
-- ── deliberately no TRUNCATE, REFERENCES or TRIGGER ──
-- `GRANT ALL` included those three. No client path uses them, and TRUNCATE is not
-- filtered by RLS at all — a role holding it can empty the table regardless of
-- policy. That is the single most valuable privilege removed here.
-- ============================================================================

-- ── news ────────────────────────────────────────────────────────────────────
revoke all on public.news from public, anon, authenticated;
grant select, insert, update, delete on public.news to authenticated;

-- ── news_seen ───────────────────────────────────────────────────────────────
-- No update/delete policy exists, so those verbs are not granted: a player marks
-- a post seen once and never unsees it.
revoke all on public.news_seen from public, anon, authenticated;
grant select, insert on public.news_seen to authenticated;
