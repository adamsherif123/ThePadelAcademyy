-- ============================================================================
-- Open (untyped) recurring templates — the lift deliberately deferred from the
-- booking rework (20260804000023 / 20260805000024). Mirrors that work exactly:
-- availability_templates.training_type becomes nullable ("open — first player
-- chooses" for a RECURRING rule, not just a one-off), and every slot it
-- generates inherits whatever shape the template itself has (generate.ts
-- already copies training_type/gender/level straight through and already
-- skips non-active templates — untouched here; see the session report).
--
-- The trap this migration exists to avoid: availability_templates_group_shape
-- was STILL the ORIGINAL two-branch shape —
--   (training_type = 'group' and gender is not null and level is not null)
--   or
--   (training_type <> 'group' and gender is null and level is null)
-- — the exact shape 20260805000024 proved vacuously-TRUE-under-NULL for
-- session_slots (branch 1's bare `training_type = 'group'` equality evaluates
-- to NULL, not FALSE, when training_type IS NULL, so
-- FALSE(branch2-ish) OR NULL OR FALSE = NULL = "satisfied" — an untyped row
-- with gender AND level both set would have slipped straight through). Simply
-- dropping NOT NULL without rewriting this CHECK would reintroduce that exact
-- bug one table over. Fixed here with the same three-branch, NULL-safe shape
-- 20260805000024 applied to session_slots_group_shape (copied verbatim in
-- structure, s/slots/templates/):
--   (training_type is null and gender is null and level is null)
--   or
--   (training_type is not null and training_type = 'group' and gender is not null and level is not null)
--   or
--   (training_type is not null and training_type <> 'group' and gender is null and level is null)
--
-- training_type's existing `check (training_type in ('trial','group','duo',
-- 'individual'))` needs NO change — `NULL IN (...)` evaluates to NULL, which a
-- CHECK treats as satisfied, so NULL already passes once NOT NULL is gone
-- (identical reasoning to 20260804000023's Task 1 note for session_slots).
--
-- No grant/policy change needed: availability_templates' admin insert/update
-- grants are plain table-level (`grant insert, update, delete ... to
-- authenticated`), unlike session_slots' column-scoped UPDATE grant — there is
-- no column list to add training_type to.
-- ============================================================================

alter table public.availability_templates
  alter column training_type drop not null;

alter table public.availability_templates drop constraint availability_templates_group_shape;
alter table public.availability_templates add constraint availability_templates_group_shape check (
  (training_type is null and gender is null and level is null)
  or
  (training_type is not null and training_type = 'group' and gender is not null and level is not null)
  or
  (training_type is not null and training_type <> 'group' and gender is null and level is null)
);
