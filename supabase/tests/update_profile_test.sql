-- ============================================================================
-- Edit profile — pgTAP proof for 20260815000034_edit_profile_update_profile.sql.
--
-- update_profile is the post-signup counterpart to complete_signup: same
-- validation shape (name/gender/level required, phone optional + E.164 +
-- phone_taken), but it UPDATES the caller's own existing row instead of
-- creating one. Mirrors auth_test.sql's complete_signup coverage — same
-- literal phone inputs/outputs, so parity between the two RPCs is visible,
-- not just asserted separately.
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(18);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1a1a1a1-1111-1111-1111-111111111111', 'up_a@players.eg'),  -- A: happy path (name/gender/level, no phone)
  ('b2b2b2b2-2222-2222-2222-222222222222', 'up_b@players.eg'),  -- B: adds a phone
  ('c3c3c3c3-3333-3333-3333-333333333333', 'up_c@players.eg'),  -- C: claims B's phone → phone_taken
  ('d4d4d4d4-4444-4444-4444-444444444444', 'up_d@players.eg'),  -- D: validation rejections
  ('e5e5e5e5-5555-5555-5555-555555555555', 'up_e@players.eg'),  -- E: authenticated, pre-signup (no player row)
  ('f6f6f6f6-6666-6666-6666-666666666666', 'admin_up@thepadelacademy.eg'); -- F: an admin

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_up', 'f6f6f6f6-6666-6666-6666-666666666666', 'AdmUp', now());

-- email set on each row (as a real complete_signup would) so the "untouched" assertion
-- below actually proves something, rather than checking NULL against NULL.
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, email) values
  ('pl_up_a', null, 'Ali Old', 'men', 'beginner', now(), 'a1a1a1a1-1111-1111-1111-111111111111', 'up_a@players.eg'),
  ('pl_up_b', null, 'Bea Old', 'ladies', 'beginner', now(), 'b2b2b2b2-2222-2222-2222-222222222222', 'up_b@players.eg'),
  ('pl_up_c', null, 'Cy Old', 'men', 'beginner', now(), 'c3c3c3c3-3333-3333-3333-333333333333', 'up_c@players.eg'),
  ('pl_up_d', null, 'Dina Old', 'ladies', 'intermediate', now(), 'd4d4d4d4-4444-4444-4444-444444444444', 'up_d@players.eg');
-- E deliberately has NO player row (pre-signup / mid-signup drop).

-- ── not_authenticated: no auth.uid() ─────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(public.update_profile('X','men','beginner')->>'reason', 'not_authenticated',
  'update_profile with no auth.uid() → not_authenticated');

-- ── is_admin: an admin identity has no player row to update ──────────────────
select set_config('request.jwt.claims', '{"sub":"f6f6f6f6-6666-6666-6666-666666666666","role":"authenticated"}', true);
select is(public.update_profile('Admin','men','beginner')->>'reason', 'is_admin',
  'an admin identity cannot update_profile → is_admin (A1 separation, defence in depth)');

-- ── no_player: authenticated, but no player row yet (pre-signup) ─────────────
select set_config('request.jwt.claims', '{"sub":"e5e5e5e5-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is(public.update_profile('X','men','beginner')->>'reason', 'no_player',
  'an authenticated pre-signup user (no player row) → no_player');

-- ── happy path (A): name/gender/level change, no phone ───────────────────────
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.update_profile('Ali New','ladies','intermediate')->>'ok', 'true',
  'A updates name/gender/level → ok');
select is((select name||'/'||gender||'/'||level||'/'||coalesce(phone,'<null>') from public.players where id='pl_up_a'),
  'Ali New/ladies/intermediate/<null>', 'the row reflects the new name/gender/level; phone stays null (never set, none given)');

-- ── validation (D): rejections leave the row untouched ───────────────────────
select set_config('request.jwt.claims', '{"sub":"d4d4d4d4-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is(public.update_profile('X','martian','beginner')->>'reason', 'invalid_gender', 'rejects an invalid gender');
select is(public.update_profile('X','men','grandmaster')->>'reason', 'invalid_level', 'rejects an invalid level');
select is(public.update_profile('   ','men','beginner')->>'reason', 'name_required', 'rejects a blank name');
select is(public.update_profile('X','men','beginner','12')->>'reason', 'invalid_phone',
  'rejects a phone that is not a valid EG mobile');
select is((select name||'/'||gender||'/'||level from public.players where id='pl_up_d'),
  'Dina Old/ladies/intermediate', 'every rejected call left D''s row completely untouched');

-- ── optional phone (B): normalised to +20 E.164, identical to complete_signup ─
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.update_profile('Bea New','ladies','beginner','0100 123 4567')->>'ok', 'true',
  'B adds an optional phone → ok');
select is((select phone from public.players where id='pl_up_b'),
  '+201001234567', 'the phone is normalised to +20 E.164 — same rule complete_signup applies');

-- a DIFFERENT player claiming the SAME real number → phone_taken (UNIQUE), no mutation
select set_config('request.jwt.claims', '{"sub":"c3c3c3c3-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.update_profile('Cy New','men','beginner','+20 100 123 4567')->>'reason', 'phone_taken',
  'a second player claiming a taken phone → phone_taken (clean reason, not a crash)');
select is((select name||'/'||coalesce(phone,'<null>') from public.players where id='pl_up_c'),
  'Cy Old/<null>', 'the phone_taken call left C''s row completely untouched (name unchanged too)');

-- ── clearing a phone: blank input → null, not a no-op / not left stale ───────
select set_config('request.jwt.claims', '{"sub":"b2b2b2b2-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.update_profile('Bea New','ladies','beginner')->>'ok', 'true',
  'B updates again with NO phone argument → ok (phone is optional, omitting it is valid)');
select is((select phone from public.players where id='pl_up_b'),
  null, 'omitting phone on this call CLEARS it — update_profile always sets exactly what it''s given, never merges');

-- ── untouched fields: email/trained_before/created_at are never written here ─
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is((select email from public.players where id='pl_up_a'), 'up_a@players.eg',
  'email is untouched by update_profile (not a parameter; it is the auth identity)');

reset role;
select is((select count(*)::int from public.credit_batches where player_id in ('pl_up_a','pl_up_b','pl_up_c','pl_up_d')),
  0, 'update_profile mints/touches zero credit batches — a pure profile write');

select * from finish();
rollback;
