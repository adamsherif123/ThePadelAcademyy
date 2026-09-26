-- ============================================================================
-- location_id on session_slots, availability_templates and packages.
--
-- Every existing row is the original branch. The column is NOT NULL from the
-- moment this migration finishes, so nothing can be created without a branch —
-- except through the temporary fallback below, which exists solely for binaries
-- that are already deployed.
--
-- ── the three-step, and why the order matters ──
-- add nullable → backfill → SET NOT NULL. Adding a NOT NULL column with a
-- DEFAULT would also work and would be one statement, but it would bake the
-- default into the column, and a column default is exactly what we do NOT want
-- long term: after launch, an INSERT with no location must FAIL, loudly, rather
-- than quietly landing at Oro Plaza. The trigger below gives us the same
-- forgiveness for now while being one `drop trigger` away from strictness.
--
-- ── the fallback trigger is TEMPORARY. Remove it at 1.4 launch. ──
-- The admin is a Vercel SPA. A tab opened before this deploy keeps running the
-- old bundle for as long as it is left open — hours, realistically overnight —
-- and that bundle's slot INSERT names a fixed column list that does not include
-- location_id. Without the fallback, every generate/one-off from a stale tab
-- would 23502 and the owner would see failures they cannot explain or fix
-- (a refresh fixes it, but nothing tells them to refresh).
--
-- So: BEFORE INSERT, a NULL location_id becomes the default. This is a
-- deployment-window crutch, not a rule. It must be dropped in the session that
-- ships 1.4, at which point a missing location is a bug and should behave like
-- one. Grep for `tpa.fill_default_location` to find all of it.
--
-- ── immutability, and why it is belt AND braces ──
-- A slot cannot move between branches: its bookings hold credits that are
-- location-locked (a later session), so moving the slot would strand them. The
-- same is true of a template (it would start generating elsewhere) and a
-- package (credits already sold against it would change where they work).
--
-- Two different mechanisms, because the two grant shapes differ:
--
--   session_slots holds COLUMN-level grants for authenticated. A new column
--   therefore arrives with NO privilege attached, and we grant INSERT
--   (location_id) and deliberately NOT UPDATE(location_id). The privilege layer
--   refuses a change with 42501 before RLS or any trigger runs. This is the
--   strong form, and it is what makes reschedule_session structurally unable to
--   move a slot's branch — it is an admin UPDATE through PostgREST, so it is
--   bound by exactly these grants.
--
--   availability_templates and packages hold TABLE-level grants
--   (SELECT,INSERT,UPDATE). A table-level grant automatically extends to every
--   column, including ones added later — so those two tables' location_id is
--   writable by authenticated the instant it exists, and no grant I can add
--   here changes that. Making it column-level would mean enumerating every
--   column of both tables and keeping that list correct forever, which is a
--   worse failure mode than the one it fixes.
--
-- Hence the BEFORE UPDATE trigger, applied to all three. On session_slots it is
-- redundant with the grant and stays anyway: it is the only protection that
-- also covers service_role and any future SECURITY DEFINER function, neither of
-- which the grant binds.
-- ============================================================================

-- ── 1. the column, nullable, with its FK ────────────────────────────────────
alter table public.session_slots
  add column location_id text references public.locations (id);
alter table public.availability_templates
  add column location_id text references public.locations (id);
alter table public.packages
  add column location_id text references public.locations (id);

-- ── 2. backfill: everything that exists today is the original branch ────────
update public.session_slots          set location_id = tpa.default_location_id() where location_id is null;
update public.availability_templates set location_id = tpa.default_location_id() where location_id is null;
update public.packages               set location_id = tpa.default_location_id() where location_id is null;

-- ── 3. the temporary fallback (see header) ──────────────────────────────────
create or replace function tpa.fill_default_location()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.location_id is null then
    new.location_id := tpa.default_location_id();
  end if;
  return new;
end;
$$;

comment on function tpa.fill_default_location() is
  'TEMPORARY (migration 062): lets a pre-1.4 admin bundle insert without location_id. Drop when 1.4 ships.';

create trigger session_slots_fill_location
  before insert on public.session_slots
  for each row execute function tpa.fill_default_location();
create trigger availability_templates_fill_location
  before insert on public.availability_templates
  for each row execute function tpa.fill_default_location();
create trigger packages_fill_location
  before insert on public.packages
  for each row execute function tpa.fill_default_location();

-- ── 4. NOT NULL, now that nothing can arrive without one ────────────────────
alter table public.session_slots          alter column location_id set not null;
alter table public.availability_templates alter column location_id set not null;
alter table public.packages               alter column location_id set not null;

-- ── 5. immutable after insert ───────────────────────────────────────────────
create or replace function tpa.location_id_is_immutable()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.location_id is distinct from old.location_id then
    raise exception
      'location_id is immutable on %: a row cannot change branch (bookings, credits and generated slots are all tied to it)',
      tg_table_name;
  end if;
  return new;
end;
$$;

create trigger session_slots_location_immutable
  before update on public.session_slots
  for each row execute function tpa.location_id_is_immutable();
create trigger availability_templates_location_immutable
  before update on public.availability_templates
  for each row execute function tpa.location_id_is_immutable();
create trigger packages_location_immutable
  before update on public.packages
  for each row execute function tpa.location_id_is_immutable();

-- ── 6. grants ───────────────────────────────────────────────────────────────
-- session_slots is column-granted, so the new column starts with nothing. It
-- gets INSERT and pointedly not UPDATE.
grant insert (location_id) on public.session_slots to authenticated;

-- availability_templates and packages need no grant: their table-level
-- SELECT,INSERT,UPDATE already covers every column including this one. Recorded
-- here so the next reader does not go looking for a missing grant — and so the
-- asymmetry with session_slots above is visibly deliberate rather than an
-- oversight. The UPDATE they implicitly hold is neutralised by the immutability
-- trigger, not by a privilege.

-- ── 7. the index the mobile slot fetch will use ─────────────────────────────
-- Equality first, range second: the query becomes
-- `where location_id = $1 and starts_at >= $2`.
-- session_slots_starts_at_idx stays — the admin still scans across branches by
-- date, and dropping it would regress that.
create index session_slots_location_starts_idx on public.session_slots (location_id, starts_at);

-- session_slots_coach_no_overlap is deliberately NOT touched. It excludes on
-- (coach_id, time range) with no location term, which is what makes it mean "a
-- coach cannot be in two places at once". Adding location_id would WEAKEN it
-- into "a coach cannot be double-booked at the same branch", permitting exactly
-- the double-booking it exists to prevent.
