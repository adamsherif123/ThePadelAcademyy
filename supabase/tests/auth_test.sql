-- ============================================================================
-- S8 — auth: FK semantics, complete_signup, and pre-signup denial (pgTAP).
--
-- This proves the LOGIC with seeded auth.users rows + synthetic JWTs. The real
-- email/password→JWT→RLS plumbing is proven separately by supabase/tests/auth_session.sh.
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(28);

-- ── seed as postgres ─────────────────────────────────────────────────────────
-- A2: auth users sign up with EMAIL now (not phone). complete_signup no longer reads
-- either — it only takes the profile fields — so these emails are just realistic identities.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@players.eg'),   -- A: happy path + idempotency
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'v@players.eg'),   -- V: validation (never gets a player)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e@players.eg'),   -- E: authenticated but pre-signup
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin@thepadelacademy.eg'),   -- F: an ADMIN (bug #2)
  ('11111111-1111-1111-1111-111111111111', 'g@players.eg'),   -- G: optional-phone happy path
  ('22222222-2222-2222-2222-222222222222', 'h@players.eg');   -- H: duplicate-phone rejection

-- F is an admin (auth user linked to an admins row, NO player) — A1 separation.
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_auth', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.coaches (id, name, bio, is_active) values ('co_auth', 'C', 'b', true);
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, status)
  values ('sl_auth', 'co_auth', now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 4, 0, 'published');

-- ── the FK and its delete semantics (catalog) ───────────────────────────────
select is((select confdeltype from pg_constraint where conname = 'players_auth_user_id_fkey'),
  'r', 'players.auth_user_id FK is ON DELETE RESTRICT (never CASCADE — financial records)');
select is((select confrelid::regclass::text from pg_constraint where conname = 'players_auth_user_id_fkey'),
  'auth.users', 'the FK references auth.users');

-- ── the third crossing constant ─────────────────────────────────────────────
select is(tpa.signup_trial_credits(), 2, 'tpa.signup_trial_credits() = 2 (mirrors SIGNUP_TRIAL_CREDITS)');

-- ── complete_signup: not_authenticated when there is no auth.uid() ──────────
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);   -- no sub → auth.uid() null
select is(public.complete_signup('X','men','beginner')->>'reason', 'not_authenticated',
  'complete_signup with no auth.uid() → not_authenticated');

-- ── complete_signup: happy path AS the freshly-verified user A ──────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.complete_signup('Ali Hassan','men','beginner')->>'ok', 'true', 'complete_signup(A) → ok');
select is(public.complete_signup('Ali Hassan','men','beginner')->>'already_completed', 'true',
  'second complete_signup(A) → already_completed (idempotent fast path)');

-- the player exists with the given profile and NO phone (A2: email auth → phone is null)
select is((select gender||'/'||level||'/'||coalesce(phone, '<null>') from public.players where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'men/beginner/<null>', 'player created with the given profile and NO phone (email auth)');
-- A2.1: the email is set from the auth user (server-side, never a client argument)
select is((select email from public.players where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'a@players.eg', 'complete_signup stored the email from the authenticated user');
-- A5: exactly ONE player, and ZERO credits at signup (the 2-free-trial grant was removed).
select is((select count(*)::int from public.players where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1, 'exactly ONE player for A''s auth user (auth_user_id UNIQUE)');
select is((select count(*)::int from public.credit_batches c join public.players p on p.id = c.player_id
           where p.auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0, 'A5: complete_signup mints ZERO credits at signup (no free trial grant)');

-- ── complete_signup: profile validation (as V, who never gets a player) ─────
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
select is(public.complete_signup('X','martian','beginner')->>'reason', 'invalid_gender', 'rejects an invalid gender');
select is(public.complete_signup('X','men','grandmaster')->>'reason', 'invalid_level', 'rejects an invalid level');
select is(public.complete_signup('   ','men','beginner')->>'reason', 'name_required', 'rejects a blank name');
select is(public.complete_signup('X','men','beginner','12')->>'reason', 'invalid_phone', 'rejects a phone that is not a valid EG mobile');
select is((select count(*)::int from public.players where auth_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'a rejected signup creates no player');

-- ── optional phone: normalised to +20 E.164, and UNIQUE ─────────────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.complete_signup('Gina','ladies','beginner','0100 123 4567')->>'ok', 'true',
  'complete_signup with an optional phone → ok');
select is((select phone from public.players where auth_user_id = '11111111-1111-1111-1111-111111111111'),
  '+201001234567', 'the optional phone is normalised to +20 E.164 before storing');
-- a DIFFERENT auth user claiming the SAME real number → phone_taken (UNIQUE), no player made
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.complete_signup('Huda','ladies','beginner','+20 100 123 4567')->>'reason', 'phone_taken',
  'a second player claiming a taken phone → phone_taken (clean reason, not a crash)');
select is((select count(*)::int from public.players where auth_user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'the phone_taken signup created no player');

-- ── an authenticated user BEFORE complete_signup is denied everywhere (as E) ─
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
select is((select public.current_player_id()), null, 'pre-signup: current_player_id() is NULL');
select is((select count(*)::int from public.credit_batches), 0, 'pre-signup: reads zero credit batches (RLS denies)');
select is(public.book_slot('sl_auth')->>'reason', 'not_authenticated', 'pre-signup: book_slot → not_authenticated');

-- ── bug #2 (backend): an ADMIN cannot complete_signup (A1's separation guard) ──
-- The consumer UI must refuse an admin, but the RPC refuses too — defence in depth.
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.complete_signup('Admin Person','men','beginner')->>'reason', 'is_admin',
  'an admin identity cannot complete_signup → is_admin (never becomes a player)');

-- ── email_has_account: exactly one bit; false for an admin; callable by anon ──
-- A2.1 routing check. It exposes only whether a LIVE player exists for the email.
select is(public.email_has_account('a@players.eg'), true, 'email_has_account → true for a player email');
select is(public.email_has_account('A@PLAYERS.EG'), true, 'email_has_account is case-insensitive');
select is(public.email_has_account('admin@thepadelacademy.eg'), false,
  'email_has_account → false for an ADMIN email (no player row → routes to create-account → refusal)');
select is(public.email_has_account('nobody@nowhere.eg'), false, 'email_has_account → false for an unknown email');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.email_has_account('a@players.eg'), true,
  'email_has_account is callable by anon (the caller is on the unauthenticated sign-in screen)');

reset role;
select * from finish();
rollback;
