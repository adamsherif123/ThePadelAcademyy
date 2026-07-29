-- ============================================================================
-- Open (untyped) recurring templates — pgTAP proof for the deferred lift
-- (20260808000027).
--
-- Proves availability_templates_group_shape's rewritten three-branch CHECK
-- (20260808000027), THEN the gender-display-only migration's further relaxation
-- (20260813000032, which dropped gender from the CHECK entirely — see that
-- migration's header note; both group_shape CHECKs, slots and templates,
-- changed in lockstep). Untyped + level NULL is legal regardless of gender;
-- level SET on an untyped row is still illegal regardless of gender; a typed
-- GROUP template may now have gender NULL (the new mixed-gender case) or SET
-- (unaffected, still legal); level's shape (required for group, forbidden
-- otherwise) is unchanged throughout.
--
-- Run with:  supabase test db  (alongside open_type_slots_test.sql)
-- ============================================================================
begin;
select plan(6);

-- Seeded as postgres (RLS bypassed; constraints still apply).
insert into public.coaches (id, name, bio, is_active) values ('co_ott_chk','C','b',true);

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk1', 'co_ott_chk', 0, '17:00', '18:00', null, 4, null, null, true) $$,
  'untyped + gender NULL + level NULL → legal (the only valid untyped shape)');

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk2', 'co_ott_chk', 1, '17:00', '18:00', null, 4, 'ladies', null, true) $$,
  'untyped + gender SET + level NULL → legal now — gender is unconstrained by the CHECK (20260813000032)');

select throws_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk3', 'co_ott_chk', 2, '17:00', '18:00', null, 4, null, 'beginner', true) $$,
  '23514', null, 'untyped + gender NULL + level SET → still rejected — level''s shape is unaffected by the gender change');

select throws_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk4', 'co_ott_chk', 3, '17:00', '18:00', null, 4, 'ladies', 'beginner', true) $$,
  '23514', null, 'untyped + gender SET + level SET → still rejected — level SET on an untyped row is illegal regardless of gender');

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk5', 'co_ott_chk', 4, '17:00', '18:00', 'group', 4, 'ladies', 'beginner', true) $$,
  'typed group + gender SET + level SET → still legal — the pre-existing typed-group requirement is unaffected by the rewrite');

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk6', 'co_ott_chk', 5, '17:00', '18:00', 'group', 4, null, 'beginner', true) $$,
  'typed group + gender NULL + level SET → legal — the new mixed-gender recurring template shape (20260813000032)');

select * from finish();
rollback;
