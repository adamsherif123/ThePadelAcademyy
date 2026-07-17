-- ============================================================================
-- S5.1 — coach double-booking exclusion, player template reads, admin writes.
--
-- Three fixes from human review of S5:
--   1. A coach can currently be in two published slots at once. Make it a hard
--      DB block (EXCLUDE USING gist). Owner accepts the tension vs S4c.3's
--      warn-not-block: overselling one coach's seats twice is a worse failure
--      than briefly being unable to record an overlap (he can cancel first).
--   2. Players must read ACTIVE templates — the Book screen derives the
--      academy's open weekdays from them (S3c). Admin-only reads made every day
--      render CLOSED. Open the class timetable to players (it's published on the
--      website anyway); admins still read all.
--   3. Give the admin a real is_admin()-gated write surface. S10 runs the admin
--      in a BROWSER, where a service_role key would bypass all RLS for anyone
--      with devtools — so admin writes must be policies, not service_role.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — a coach cannot be in two places at once.
--   btree_gist supplies the gist operator class for the scalar `coach_id = `
--   half of the exclusion; tstzrange `&&` is built in. Installed into `public`
--   so the default gist opclass for `text` is always on the migration role's
--   search_path when the constraint is built (reliability over lint tidiness).
--
--   WHERE (status = 'published'): only published slots block each other. A
--   CANCELLED slot must never block its own replacement.
--   tstzrange(starts_at, ends_at) is the default '[)' bound: touching is NOT
--   overlapping, so 18:00–20:00 and 20:00–22:00 both stand. Back-to-back
--   sessions are the norm; proven in rls_test.sql.
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists btree_gist;

alter table public.session_slots
  add constraint session_slots_coach_no_overlap
  exclude using gist (coach_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'published');

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — players read ACTIVE templates (open-weekday derivation).
--   SELECT is already granted to authenticated in S5. Add a permissive policy
--   for active rows; it ORs with the existing admin-all policy, so admins keep
--   seeing inactive templates too. Not granted to anon: the derivation runs on
--   the authenticated Book screen, so anon has no need — least disclosure.
-- ─────────────────────────────────────────────────────────────────────────────
create policy availability_templates_select_active on public.availability_templates
  for select to authenticated
  using (is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 3 — admin write surface, gated on is_admin().
--   Pattern for every table below: grant the table privilege to `authenticated`
--   (so the API layer can attempt the write) and gate the actual rows on
--   is_admin() in the policy — a non-admin holds the privilege but every row
--   fails the policy, so their write is denied (INSERT → RLS error; UPDATE/
--   DELETE → zero rows). service_role is unaffected and still bypasses RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── coaches: admin insert + update. NO delete. ──────────────────────────────
-- Deletion is intentionally absent: is_active is the honest "remove a coach"
-- operation, and hard-deleting a coach with historical slots/bookings is a
-- foot-gun (and would fail the FK anyway). Deactivate, don't delete.
grant insert, update on public.coaches to authenticated;
create policy coaches_admin_insert on public.coaches
  for insert to authenticated
  with check ((select public.is_admin()));
create policy coaches_admin_update on public.coaches
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ── packages: admin insert + update. NO delete. ─────────────────────────────
-- Same reasoning as coaches: deactivate via is_active; purchases reference
-- packages historically.
grant insert, update on public.packages to authenticated;
create policy packages_admin_insert on public.packages
  for insert to authenticated
  with check ((select public.is_admin()));
create policy packages_admin_update on public.packages
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ── availability_templates: admin insert + update + delete. ─────────────────
-- Templates are pure config with no money trail; deleting an unused one is
-- reasonable (a delete of one still referenced by a generated slot is blocked
-- by session_slots.template_id's FK — the DB stops that foot-gun for us).
grant insert, update, delete on public.availability_templates to authenticated;
create policy availability_templates_admin_insert on public.availability_templates
  for insert to authenticated
  with check ((select public.is_admin()));
create policy availability_templates_admin_update on public.availability_templates
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy availability_templates_admin_delete on public.availability_templates
  for delete to authenticated
  using ((select public.is_admin()));

-- ── session_slots: admin insert + update, but booked_count is OFF LIMITS. ────
-- Column-scoped grants are the mechanism (same shape that protects is_admin on
-- players): the admin may write only the columns listed. booked_count is NOT
-- grantable to any client role — it belongs solely to S7's atomic booking RPC.
-- An admin UPDATE that touches booked_count is rejected at the privilege layer
-- (42501) before RLS is even consulted. INSERT omits booked_count too, so a new
-- slot always starts at its DEFAULT 0.
grant insert (id, coach_id, starts_at, ends_at, training_type, capacity, gender, level, status, template_id)
  on public.session_slots to authenticated;
grant update (coach_id, capacity, starts_at, ends_at, status)
  on public.session_slots to authenticated;
create policy session_slots_admin_insert on public.session_slots
  for insert to authenticated
  with check ((select public.is_admin()));
create policy session_slots_admin_update on public.session_slots
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ── bookings & credit_batches: STILL no write policies. ─────────────────────
-- Deliberately untouched. Every mutation there is money-equivalent and must be
-- atomic (book+spend one credit, cancel+refund N, admin_grant mints a batch) —
-- that is S7's SECURITY DEFINER RPC territory. An admin write policy here would
-- let the admin app decrement a credit without inserting a booking, or grant
-- credits outside the audited admin_grant path. The line stays where S5 drew it.
