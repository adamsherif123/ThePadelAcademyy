-- ============================================================================
-- Open (untyped) recurring templates — pgTAP proof for the deferred lift
-- (20260808000027).
--
-- Proves availability_templates_group_shape's rewritten three-branch CHECK:
-- the untyped shape (gender/level both null) is the only LEGAL untyped row;
-- the three illegal untyped combinations (gender-only, level-only, both set —
-- the exploit shape the old two-branch CHECK vacuously passed under NULL
-- three-valued logic) are all rejected; and the pre-existing typed-group
-- requirement (gender+level both set) still holds, unaffected by the rewrite.
--
-- Run with:  supabase test db  (alongside open_type_slots_test.sql)
-- ============================================================================
begin;
select plan(5);

-- Seeded as postgres (RLS bypassed; constraints still apply).
insert into public.coaches (id, name, bio, is_active) values ('co_ott_chk','C','b',true);

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk1', 'co_ott_chk', 0, '17:00', '18:00', null, 4, null, null, true) $$,
  'untyped + gender NULL + level NULL → legal (the only valid untyped shape)');

select throws_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk2', 'co_ott_chk', 1, '17:00', '18:00', null, 4, 'ladies', null, true) $$,
  '23514', null, 'untyped + gender SET + level NULL → rejected');

select throws_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk3', 'co_ott_chk', 2, '17:00', '18:00', null, 4, null, 'beginner', true) $$,
  '23514', null, 'untyped + gender NULL + level SET → rejected');

select throws_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk4', 'co_ott_chk', 3, '17:00', '18:00', null, 4, 'ladies', 'beginner', true) $$,
  '23514', null, 'untyped + gender SET + level SET → rejected — THE exploit shape the old two-branch CHECK vacuously passed');

select lives_ok(
  $$ insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, gender, level, is_active)
       values ('at_ott_chk5', 'co_ott_chk', 4, '17:00', '18:00', 'group', 4, 'ladies', 'beginner', true) $$,
  'typed group + gender SET + level SET → still legal — the pre-existing typed-group requirement is unaffected by the rewrite');

select * from finish();
rollback;
