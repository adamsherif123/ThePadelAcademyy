-- ============================================================================
-- S8 — auth: FK semantics, complete_signup, and pre-signup denial (pgTAP).
--
-- This proves the LOGIC with seeded auth.users rows + synthetic JWTs. The real
-- email/password→JWT→RLS plumbing is proven separately by supabase/tests/auth_session.sh.
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(20);

-- ── seed as postgres ─────────────────────────────────────────────────────────
-- A2: auth users sign up with EMAIL now (not phone). complete_signup no longer reads
-- either — it only takes the profile fields — so these emails are just realistic identities.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@players.eg'),   -- A: happy path + idempotency
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'v@players.eg'),   -- V: validation (never gets a player)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e@players.eg'),   -- E: authenticated but pre-signup
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin@thepadelacademy.eg');   -- F: an ADMIN (bug #2)

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
-- exactly ONE player and ONE signup_grant of 2 trial credits, expiring in 30 days
select is((select count(*)::int from public.players where auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1, 'exactly ONE player for A''s auth user (auth_user_id UNIQUE)');
select is((select count(*)::int from public.credit_batches c join public.players p on p.id = c.player_id
           where p.auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and c.source = 'signup_grant'),
  1, 'exactly ONE signup_grant (partial index → no double grant on the double call)');
select is((select quantity_remaining from public.credit_batches c join public.players p on p.id = c.player_id
           where p.auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'the grant is 2 trial credits');
select is((select training_type from public.credit_batches c join public.players p on p.id = c.player_id
           where p.auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'trial', 'the credits are trial credits');
select is((select c.expires_at - c.created_at from public.credit_batches c join public.players p on p.id = c.player_id
           where p.auth_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  interval '30 days', 'trial credits expire in 30 days (tpa.credit_expiry — no extra time)');

-- ── complete_signup: profile validation (as V, who never gets a player) ─────
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
select is(public.complete_signup('X','martian','beginner')->>'reason', 'invalid_gender', 'rejects an invalid gender');
select is(public.complete_signup('X','men','grandmaster')->>'reason', 'invalid_level', 'rejects an invalid level');
select is(public.complete_signup('   ','men','beginner')->>'reason', 'name_required', 'rejects a blank name');
select is((select count(*)::int from public.players where auth_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0, 'a rejected signup creates no player');

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

reset role;
select * from finish();
rollback;
