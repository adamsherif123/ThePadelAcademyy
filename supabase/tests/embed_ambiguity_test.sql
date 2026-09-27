-- ============================================================================
-- PostgREST embed ambiguity — the guard that would have caught it (pgTAP).
--
-- WHAT WENT WRONG
-- 065 added bookings_slot_same_location (slot_id, location_id) → session_slots
-- (id, location_id) beside the original bookings_slot_id_fkey, and the same for
-- credit_batches. Two foreign keys between one pair of tables means PostgREST
-- can no longer tell which one an embed meant, and it refuses to guess:
--
--     GET /bookings?select=*,session_slots!inner(*)
--     300  PGRST201  Could not embed because more than one relationship was found
--
-- Nothing in SQL broke. No test failed. The admin's entire Bookings page and the
-- mobile app's "Load older" simply started returning 300 — and the mobile query
-- is baked into the shipped 1.2/1.3 binaries, which can never be updated.
--
-- WHAT THIS TEST DOES
-- 1. Pins the constraint names the clients now hint at, so renaming or dropping
--    one is a red test rather than a page that dies in production.
-- 2. Fails on any NEW pair of tables that gains a second foreign key. That is the
--    general shape of this bug: a composite "same location" FK looks purely
--    additive in SQL and is a breaking change to every embed across that pair.
--    If this test goes red, the fix is not to widen the allowlist — it is to go
--    and name the relationship in every client query that embeds those tables.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(8);

-- ── 1. the two constraints the clients name, by exact name ──────────────────
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.bookings'::regclass and conname = 'bookings_slot_same_location'),
  1, 'bookings_slot_same_location exists — admin BOOKINGS_PAGE_SELECT and mobile fetchPastSessionsPage both hint at it by name');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.bookings'::regclass and conname = 'bookings_slot_same_location'),
  'FOREIGN KEY (slot_id, location_id) REFERENCES session_slots(id, location_id)',
  'and it still points where those queries think it does');

-- ── 2. the ambiguity itself, stated rather than discovered ──────────────────
-- Asserting the CURRENT count (not "= 1") is the point: these two pairs are
-- knowingly ambiguous, every client embed across them is hinted, and this line
-- is what makes the next person read the comment above before adding a third.
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.bookings'::regclass and confrelid = 'public.session_slots'::regclass
      and contype = 'f'),
  2, 'bookings → session_slots has exactly 2 FKs: any embed across it MUST be hinted');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.bookings'::regclass and confrelid = 'public.credit_batches'::regclass
      and contype = 'f'),
  2, 'bookings → credit_batches has exactly 2 FKs: same rule');

-- ── 3. no OTHER pair has become ambiguous ───────────────────────────────────
select is(
  (select coalesce(string_agg(pair, ', ' order by pair), 'none') from (
     select conrelid::regclass::text || ' → ' || confrelid::regclass::text as pair
     from pg_constraint
     where contype = 'f' and connamespace = 'public'::regnamespace
     group by conrelid, confrelid
     having count(*) > 1
   ) t
   where pair not in ('bookings → session_slots', 'bookings → credit_batches')),
  'none',
  'no table pair beyond the two known ones has a second FK — a new one silently breaks every embed across it');

-- ── 4. the redundancy that makes the single-column FKs droppable ────────────
-- Recorded here because it is the whole argument for the fix the shipped 1.2/1.3
-- binaries need: with all three columns NOT NULL, the composite FK is a strict
-- superset of the single-column one, so dropping the latter costs no integrity
-- and leaves exactly one relationship for PostgREST to find.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name in ('slot_id', 'credit_batch_id', 'location_id')
      and is_nullable = 'NO'),
  3, 'bookings.slot_id, .credit_batch_id and .location_id are all NOT NULL');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.bookings'::regclass and conname = 'bookings_slot_id_fkey'),
  'FOREIGN KEY (slot_id) REFERENCES session_slots(id)',
  'bookings_slot_id_fkey is the redundant single-column one (a prefix of the composite)');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.bookings'::regclass and conname = 'bookings_credit_batch_id_fkey'),
  'FOREIGN KEY (credit_batch_id) REFERENCES credit_batches(id)',
  'and bookings_credit_batch_id_fkey is its counterpart for credit batches');

select * from finish();
rollback;
