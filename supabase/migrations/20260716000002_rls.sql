-- ============================================================================
-- S5 — Row-Level Security.
--
-- This is the real security boundary, not the UI. Principles:
--   * RLS is ON for every table. No USING (true) on user data.
--   * Every user-data policy references auth.uid() (via the helpers below).
--   * Admin = the is_admin flag, read only through a SECURITY DEFINER helper so
--     a player can never see or set it via the API (column-level GRANT).
--   * The client writes ONLY pending purchases. Never credit_batches. Never
--     bookings (S7's SECURITY DEFINER RPC does that atomically).
--   * Public reads only where genuinely public: active coaches, active
--     packages, published slots.
--
-- Performance: auth.uid() and the helpers are wrapped as (select …) so Postgres
-- runs them once per statement (initPlan) instead of once per row — the current
-- Supabase-recommended pattern.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper functions. SECURITY DEFINER so they read public.players WITHOUT being
-- subject to players' own RLS — this is what prevents the classic infinite
-- recursion of "a players policy that queries players". search_path is pinned
-- to '' and every reference is schema-qualified, so the definer's rights can't
-- be hijacked by a caller-controlled search_path.
-- ─────────────────────────────────────────────────────────────────────────────

-- The pl_ id of the player owning the current JWT, or NULL for anon / unlinked.
create or replace function public.current_player_id()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select id from public.players where auth_user_id = (select auth.uid())
$$;

-- Is the current JWT an admin? False for anon / unlinked / non-admin.
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    (select is_admin from public.players where auth_user_id = (select auth.uid())),
    false
  )
$$;

revoke all on function public.current_player_id() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_player_id() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Known-baseline privileges. Wipe any inherited table grants for the two client
-- roles, then hand back exactly what each policy needs. service_role is left
-- untouched: it bypasses RLS and performs the S6 webhook / S7 booking writes.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;

-- ── players ──────────────────────────────────────────────────────────────────
alter table public.players enable row level security;
grant select on public.players to authenticated;
-- Column-level UPDATE grant is the mechanism that stops self-promotion: even
-- though the UPDATE policy lets a player touch their own row, the role may only
-- write name/gender/level. Setting is_admin, phone, auth_user_id, id or
-- created_at is rejected at the privilege layer (42501) before RLS is consulted.
grant update (name, gender, level) on public.players to authenticated;
-- (No INSERT/DELETE grant: player rows are created server-side in S8.)

-- A player reads only their own row; an admin reads everyone.
create policy players_select_self_or_admin on public.players
  for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.is_admin()));

-- A player updates only their own row (and, per the column grant, only
-- name/gender/level). WITH CHECK keeps auth_user_id from being repointed.
create policy players_update_self on public.players
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- ── coaches ──────────────────────────────────────────────────────────────────
alter table public.coaches enable row level security;
grant select on public.coaches to anon, authenticated;
-- Public (incl. anon) may read only ACTIVE coaches.
create policy coaches_select_active_public on public.coaches
  for select to anon, authenticated
  using (is_active);
-- Admin sees inactive coaches too.
create policy coaches_select_all_admin on public.coaches
  for select to authenticated
  using ((select public.is_admin()));
-- (No client writes: coaches are managed by the service role.)

-- ── packages ─────────────────────────────────────────────────────────────────
alter table public.packages enable row level security;
grant select on public.packages to anon, authenticated;
create policy packages_select_active_public on public.packages
  for select to anon, authenticated
  using (is_active);
create policy packages_select_all_admin on public.packages
  for select to authenticated
  using ((select public.is_admin()));
-- (No client writes.)

-- ── purchases ────────────────────────────────────────────────────────────────
alter table public.purchases enable row level security;
grant select, insert on public.purchases to authenticated;
-- (No UPDATE/DELETE grant: only the S6 webhook, as service_role, advances a
-- purchase to succeeded/failed. The client can never self-confirm payment.)

-- A player reads their own purchases; an admin reads all.
create policy purchases_select_own_or_admin on public.purchases
  for select to authenticated
  using (player_id = (select public.current_player_id()) or (select public.is_admin()));

-- A player may insert ONLY a pending purchase, for themselves, with no gateway
-- handles yet, and with amount pinned to the live price of the ACTIVE package
-- being bought. This is the whole client-side write surface for payments.
--
-- LOAD-BEARING — DO NOT "simplify" the amount subselect. It is RLS-filtered:
-- `(select price from public.packages where id = package_id)` runs under the
-- caller's own policies, so an INACTIVE package (invisible to the player via
-- packages_select_active_public) yields NULL → `amount = NULL` → NULL → the
-- WITH CHECK fails. This subselect is therefore the ONLY thing stopping a
-- player from purchasing a hidden/inactive package. Proven by rls_test.sql
-- ("player cannot purchase an inactive package even with the correct amount").
create policy purchases_insert_own_pending on public.purchases
  for insert to authenticated
  with check (
    player_id = (select public.current_player_id())
    and status = 'pending'
    and gateway_order_id is null
    and gateway_transaction_id is null
    and amount = (select price from public.packages where id = package_id)
  );

-- ── credit_batches ───────────────────────────────────────────────────────────
alter table public.credit_batches enable row level security;
grant select on public.credit_batches to authenticated;
-- (No INSERT/UPDATE/DELETE — at all. Credits are minted server-side only,
-- refunds included. The client has zero write surface on the wallet.)

create policy credit_batches_select_own_or_admin on public.credit_batches
  for select to authenticated
  using (player_id = (select public.current_player_id()) or (select public.is_admin()));

-- ── availability_templates ───────────────────────────────────────────────────
alter table public.availability_templates enable row level security;
grant select on public.availability_templates to authenticated;
-- Templates are back-office config (they generate slots); not public. Admin-read
-- only, no client writes.
create policy availability_templates_select_admin on public.availability_templates
  for select to authenticated
  using ((select public.is_admin()));

-- ── session_slots ────────────────────────────────────────────────────────────
alter table public.session_slots enable row level security;
grant select on public.session_slots to anon, authenticated;
-- (No client writes: booked_count is advanced only by S7's atomic RPC /
-- service_role.)
create policy session_slots_select_published_public on public.session_slots
  for select to anon, authenticated
  using (status = 'published');
create policy session_slots_select_all_admin on public.session_slots
  for select to authenticated
  using ((select public.is_admin()));

-- ── bookings ─────────────────────────────────────────────────────────────────
alter table public.bookings enable row level security;
grant select on public.bookings to authenticated;
-- (No INSERT/UPDATE/DELETE for clients. S7's SECURITY DEFINER RPC — owned by a
-- privileged role — inserts bookings atomically and bypasses RLS. A direct
-- client insert is denied here, today.)
create policy bookings_select_own_or_admin on public.bookings
  for select to authenticated
  using (player_id = (select public.current_player_id()) or (select public.is_admin()));
