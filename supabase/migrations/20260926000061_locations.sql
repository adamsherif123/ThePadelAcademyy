-- ============================================================================
-- locations — the second branch, and the first table that knows there is more
-- than one academy.
--
-- Nothing reads this yet. It exists so the next migration can hang location_id
-- off session_slots, availability_templates and packages with a real FK, and so
-- the admin can start entering branches before anything depends on them.
--
-- ── is_default is set HERE and nowhere else ──
-- Exactly one row is the default, enforced by a partial unique index. It is the
-- pin for every legacy client: 1.2 and 1.3 cannot filter by location and cannot
-- send one, so everything they see and everything they insert has to resolve to
-- this row. That makes it a load-bearing constant, not a setting — if an admin
-- could move it, a stale binary's whole world would move with it, mid-session.
-- So there is no RPC for it, and the column-level grants below mean the API
-- cannot write it even with a hand-rolled request: `authenticated` simply holds
-- no privilege on the `is_default` column. Changing it is a migration.
--
-- Same reasoning for `id`: no INSERT grant, so the client supplies every other
-- column and the id comes from the default below. This is a deliberate departure
-- from the "the INSERT code supplies the id, the DB has no default" convention
-- in types/ids.ts — that convention exists so a missing id fails loudly rather
-- than silently colliding, which a gen_random_uuid() default also satisfies,
-- and here it buys us an id the API provably cannot choose.
--
-- ── the seed is copied from the mobile ACADEMY constant ──
-- apps/mobile/src/ui/AcademyCard.tsx:10-32 is where these four facts live today,
-- hardcoded in the binary that 1.2 and 1.3 users are running. Copying them
-- verbatim means the row and the shipped app agree exactly; when the mobile app
-- starts reading locations (1.4) the displayed text does not shift.
-- ============================================================================

create table public.locations (
  id          text primary key default ('loc_' || gen_random_uuid()),
  name        text not null check (btrim(name) <> ''),
  address     text not null check (btrim(address) <> ''),
  -- Deep link for the "tap for directions" row. http(s) only, same shape rule as
  -- news.link_url (migration 055) so one bad paste cannot become a tap target.
  maps_url    text not null check (maps_url ~ '^https?://[^[:space:]]+$'),
  -- Free text, e.g. 'Sun – Wed · 5:00 PM – 11:00 PM'. Deliberately NOT structured:
  -- the real opening rule is availability_templates; this is the human sentence
  -- shown on a card, and branches will want to phrase it differently.
  hours_text  text not null check (btrim(hours_text) <> ''),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on column public.locations.is_default is
  'The branch every legacy (pre-1.4) client is pinned to. Set by migration only — no API path may write it.';

-- Exactly one default, ever. A partial unique index rather than a CHECK because
-- the constraint is across rows, not within one (the signup-grant pattern).
create unique index locations_one_default on public.locations (is_default) where is_default;

-- The admin list order, and the mobile picker's later.
create index locations_sort_idx on public.locations (sort_order, name);

-- ── the original branch ──────────────────────────────────────────────────────
-- Fixed id, not generated: the next migration backfills three tables against it,
-- and a stable literal is greppable in a way a uuid is not.
insert into public.locations
  (id, name, address, maps_url, hours_text, sort_order, is_active, is_default, created_at)
values (
  'loc_oro_plaza',
  'Oro Plaza Hotel',
  'In front of Family Park, Cairo',
  'https://maps.google.com/?q=Oro+Plaza+Hotel+Rehab+Cairo',
  'Sun – Wed · 5:00 PM – 11:00 PM',
  0, true, true, now()
);

-- ── the helper every later migration resolves the pin through ────────────────
-- STABLE, not IMMUTABLE: it reads a table. One row, indexed, so the planner can
-- cache it within a statement.
create or replace function tpa.default_location_id()
  returns text
  language sql
  stable
  set search_path = ''
as $$
  select id from public.locations where is_default;
$$;

revoke all on function tpa.default_location_id() from public, anon, authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.locations enable row level security;

-- Clear Supabase's default privileges BY NAME first. `revoke ... from public`
-- alone does not touch them — that was the news/news_seen bug (migration 060),
-- and it is the reason this line names all three roles.
revoke all on public.locations from public, anon, authenticated;

-- Every signed-in user reads every location: a player needs the name and map of
-- the branch a session belongs to even when browsing another, and a coach works
-- across branches. Inactive rows are filtered client-side, not hidden by RLS —
-- a booking at a since-deactivated branch must still render its address.
grant select on public.locations to authenticated;

-- Writes are column-scoped: id and is_default are absent on purpose, so the
-- privilege layer refuses them before RLS is consulted (the notifications
-- read_at pattern, migration 014). is_active IS writable, but the guard RPC
-- below is the only sane way to flip it — see its comment.
grant insert (name, address, maps_url, hours_text, sort_order, is_active)
  on public.locations to authenticated;
grant update (name, address, maps_url, hours_text, sort_order, is_active)
  on public.locations to authenticated;

-- anon gets nothing. The mobile app reads locations only once signed in (1.4),
-- and the sign-in screen keeps its hardcoded brand line.

create policy locations_select_authenticated on public.locations
  for select to authenticated
  using (true);

create policy locations_insert_admin on public.locations
  for insert to authenticated
  with check ((select public.is_admin()));

create policy locations_update_admin on public.locations
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No DELETE policy and no DELETE grant, for anybody. A location is referenced by
-- slots, templates and packages; removing one would either orphan history or
-- cascade into it. Deactivation is the only retirement, exactly as packages and
-- availability_templates already work.

-- ── the deactivation guard ───────────────────────────────────────────────────
-- An RPC rather than a trigger, for two reasons.
--
-- A trigger can only raise, and a raise reaches the admin as a bare 23514/P0001
-- with a message no UI can branch on. Every refusal in this codebase that a
-- human is meant to read is {ok, reason} — the admin then renders its own copy
-- and can say "3 sessions are still scheduled there" instead of surfacing a
-- Postgres string. This refusal is entirely a human workflow decision, so it
-- belongs in that family.
--
-- The trigger form is also wrong about WHO: a trigger fires for service_role and
-- for future server-side code that may legitimately need to deactivate during a
-- migration, and it cannot tell them apart from an admin clicking a button.
--
-- The UPDATE(is_active) grant stays, so an admin CAN technically flip the column
-- with a hand-rolled PATCH and bypass this. That is accepted: the guard protects
-- against a mistake in the admin UI, not against an admin who has decided to do
-- something deliberate with a REST client. Making it unbypassable would mean
-- dropping the column grant and routing every edit through RPCs, which buys
-- nothing against a role that can already edit every other field.
create or replace function public.set_location_active(p_location_id text, p_active boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_loc     public.locations;
  v_slots   int;
  v_tmpls   int;
begin
  if not (select public.is_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select * into v_loc from public.locations where id = p_location_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'location_missing');
  end if;

  -- Idempotent: the same click twice is not an error.
  if v_loc.is_active = p_active then
    return jsonb_build_object('ok', true, 'already', true, 'is_active', p_active);
  end if;

  if not p_active then
    if v_loc.is_default then
      return jsonb_build_object('ok', false, 'reason', 'default_location');
    end if;

    -- Future PUBLISHED slots only. A cancelled future slot is already not
    -- happening, and a past slot is history that deactivation does not disturb.
    select count(*) into v_slots
      from public.session_slots s
     where s.location_id = p_location_id
       and s.status = 'published'
       and s.starts_at > now();
    if v_slots > 0 then
      return jsonb_build_object('ok', false, 'reason', 'has_future_slots', 'slots', v_slots);
    end if;

    -- An active template would keep generating new slots into a dead branch.
    -- deleted_at is excluded: a retired rule never generates again.
    select count(*) into v_tmpls
      from public.availability_templates t
     where t.location_id = p_location_id
       and t.is_active
       and t.deleted_at is null;
    if v_tmpls > 0 then
      return jsonb_build_object('ok', false, 'reason', 'has_active_templates', 'templates', v_tmpls);
    end if;
  end if;

  update public.locations set is_active = p_active where id = p_location_id;
  return jsonb_build_object('ok', true, 'already', false, 'is_active', p_active);
end;
$$;

comment on function public.set_location_active(text, boolean) is
  'Admin-only. Activates or deactivates a location; refuses to deactivate the default, one with future published slots, or one with active templates.';

revoke all on function public.set_location_active(text, boolean) from public, anon;
grant execute on function public.set_location_active(text, boolean) to authenticated;
