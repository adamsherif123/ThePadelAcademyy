-- ============================================================================
-- S5 — Padel Academy schema: tables, constraints, indexes.
--
-- This mirrors @tpa/types (packages/types/src/entities.ts + unions.ts). Where
-- the DB and the types disagree, the types win. The two exceptions are infra
-- columns that intentionally do NOT exist in @tpa/types because they are an
-- auth/authorization concern, not part of the domain model:
--   * players.auth_user_id  — links a domain player to a Supabase auth user
--   * players.is_admin      — authorization flag consumed only by RLS
-- Both are documented at their definitions below.
--
-- Conventions enforced here (each earned from a real bug — see the S5 brief):
--   * Every PK is a text id with NO database default. Insert code supplies it
--     (pl_, co_, pk_, pu_, cb_, sl_, bk_, at_).
--   * Money is integer piastres. Never float, never numeric-with-decimals.
--   * Enums are modelled as text + CHECK, not Postgres enums (justified below).
--   * Templates store wall-clock LOCAL time (`time`); slots store UTC instants
--     (`timestamptz`). Different kinds of data → deliberately different types.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Enum strategy: text + CHECK, NOT Postgres `enum`.
--   CreditSource already gained a member once (purchase → +signup_grant →
--   +admin_grant). Evolving a text+CHECK domain is a one-line CHECK edit that
--   runs transactionally; `ALTER TYPE ... ADD VALUE` historically could not run
--   inside a transaction, cannot be removed/reordered, and complicates
--   down-migrations. text also compares directly against JWT claims in RLS.
--   The CHECK lists mirror the `satisfies readonly <Union>[]` arrays in
--   packages/core/src/constants.ts one-for-one.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── players ──────────────────────────────────────────────────────────────────
-- Player (entities.ts): id, phone, name, gender, level, createdAt.
-- gender/level are NON-null on a player (unlike on slots/templates).
create table public.players (
  id            text primary key,                       -- pl_… supplied by app, no default
  phone         text not null unique,                   -- login identity; one player per phone
  name          text not null,
  gender        text not null check (gender in ('men', 'ladies')),
  level         text not null check (level in ('beginner', 'adv_beginner', 'intermediate')),
  created_at    timestamptz not null,                   -- app supplies the instant (see @tpa/core time.ts)
  -- infra columns (NOT in @tpa/types) --------------------------------------
  auth_user_id  uuid unique,                            -- maps to auth.users(id); wired in S8. FK deferred to S8.
  is_admin      boolean not null default false          -- authorization flag; only RLS/service-role reads it
);

-- ── coaches ──────────────────────────────────────────────────────────────────
-- Coach: id, name, bio, photoUrl (nullable), isActive.
create table public.coaches (
  id         text primary key,                          -- co_…
  name       text not null,
  bio        text not null,
  photo_url  text,                                      -- nullable: coach may have no photo yet
  is_active  boolean not null default true
);

-- ── packages ─────────────────────────────────────────────────────────────────
-- Package: id, trainingType, sessionCount (int >= 1), price (piastres), name, isActive.
create table public.packages (
  id             text primary key,                      -- pk_…
  training_type  text not null check (training_type in ('trial', 'group', 'duo', 'individual')),
  session_count  integer not null check (session_count >= 1),
  price          integer not null check (price >= 0),   -- integer piastres
  name           text not null,
  is_active      boolean not null default true
);

-- ── purchases ────────────────────────────────────────────────────────────────
-- Purchase: id, playerId, packageId, status, amount (piastres), createdAt,
-- gatewayOrderId (nullable), gatewayTransactionId (nullable).
-- The client may ONLY ever insert status='pending' (enforced in RLS, not here);
-- only a verified webhook (S6) advances it. amount is captured on the row so
-- historical purchases are immune to later package repricing.
create table public.purchases (
  id                      text primary key,             -- pu_…
  player_id               text not null references public.players (id),
  package_id              text not null references public.packages (id),
  status                  text not null check (status in ('pending', 'succeeded', 'failed')),
  amount                  integer not null check (amount >= 0),  -- integer piastres
  created_at              timestamptz not null,
  gateway_order_id        text,                         -- null until the gateway is engaged
  gateway_transaction_id  text                          -- null until a transaction exists
);

-- ── credit_batches ───────────────────────────────────────────────────────────
-- CreditBatch: id, playerId, source, purchaseId (nullable), trainingType,
-- quantityTotal, quantityRemaining, expiresAt, createdAt, note (nullable).
-- Credits are TYPED (a group credit can't book an individual slot) and expire.
create table public.credit_batches (
  id                  text primary key,                 -- cb_…
  player_id           text not null references public.players (id),
  source              text not null check (source in ('purchase', 'signup_grant', 'admin_grant')),
  purchase_id         text references public.purchases (id),
  training_type       text not null check (training_type in ('trial', 'group', 'duo', 'individual')),
  quantity_total      integer not null check (quantity_total >= 1),
  quantity_remaining  integer not null check (quantity_remaining >= 0),
  expires_at          timestamptz not null,
  created_at          timestamptz not null,
  note                text,
  -- INVARIANT (entities.ts): source='purchase' ⟺ purchase_id IS NOT NULL.
  -- Grants (signup_grant, admin_grant) have no purchase behind them.
  constraint credit_batches_purchase_link
    check ((source = 'purchase') = (purchase_id is not null)),
  -- quantity_remaining can never exceed what was granted.
  constraint credit_batches_remaining_le_total
    check (quantity_remaining <= quantity_total),
  -- note explains WHY a player was comped; it is only meaningful for admin_grant.
  -- A note on a purchase/signup batch would be misleading in an audit. Chosen
  -- strict (see report); trivially relaxed later by dropping this one CHECK.
  constraint credit_batches_note_admin_only
    check (note is null or source = 'admin_grant')
);

-- The 2-free-trial-credit signup grant must be idempotent: it can fire at most
-- once per player, ever. A partial unique index is the enforcement.
create unique index credit_batches_one_signup_grant_per_player
  on public.credit_batches (player_id)
  where source = 'signup_grant';

-- ── availability_templates ───────────────────────────────────────────────────
-- AvailabilityTemplate: id, coachId, weekday, startTime, endTime, trainingType,
-- capacity, gender (nullable), level (nullable), isActive.
-- Recurring weekly rule in Cairo LOCAL wall-clock time — NOT an instant. Stored
-- as `time` (no zone): DST-agnostic wall-clock, distinct from timestamptz.
create table public.availability_templates (
  id             text primary key,                      -- at_…
  coach_id       text not null references public.coaches (id),
  weekday        smallint not null check (weekday between 0 and 6),  -- 0=Sun … 6=Sat
  start_time     time not null,                         -- Cairo local HH:mm
  end_time       time not null,
  training_type  text not null check (training_type in ('trial', 'group', 'duo', 'individual')),
  capacity       integer not null check (capacity >= 1),  -- source of truth; "Single" = capacity 1
  gender         text check (gender in ('men', 'ladies')),
  level          text check (level in ('beginner', 'adv_beginner', 'intermediate')),
  is_active      boolean not null default true,
  constraint availability_templates_time_order check (start_time < end_time),
  -- Group invariant (see report): group ⟺ gender AND level present; every other
  -- format has BOTH null. Strict form also forbids a partial (gender set, level
  -- null) which the loose biconditional would allow.
  constraint availability_templates_group_shape check (
    (training_type = 'group' and gender is not null and level is not null)
    or
    (training_type <> 'group' and gender is null and level is null)
  )
);

-- ── session_slots ────────────────────────────────────────────────────────────
-- SessionSlot: id, coachId, startsAt, endsAt, trainingType, capacity,
-- bookedCount, gender (nullable), level (nullable), status, templateId (nullable).
-- capacity is the SINGLE source of truth for seats; bookedCount tracks live
-- occupancy 0..capacity. Both are UTC instants (timestamptz).
create table public.session_slots (
  id             text primary key,                      -- sl_…
  coach_id       text not null references public.coaches (id),
  starts_at      timestamptz not null,                  -- UTC instant
  ends_at        timestamptz not null,
  training_type  text not null check (training_type in ('trial', 'group', 'duo', 'individual')),
  capacity       integer not null check (capacity >= 1),
  booked_count   integer not null default 0 check (booked_count >= 0),
  gender         text check (gender in ('men', 'ladies')),
  level          text check (level in ('beginner', 'adv_beginner', 'intermediate')),
  status         text not null check (status in ('published', 'cancelled')),
  template_id    text references public.availability_templates (id),  -- null for ad-hoc slots
  constraint session_slots_time_order check (starts_at < ends_at),
  -- Core concurrency + capacity invariant. This single CHECK enforces BOTH:
  --   (a) no oversell — a booking increment cannot push booked_count past capacity;
  --   (b) admin cannot lower capacity below what is already booked.
  -- S7's atomic-increment RPC depends on this. See report for the guarantee.
  constraint session_slots_not_oversold check (booked_count <= capacity),
  -- Same strict group invariant as templates.
  constraint session_slots_group_shape check (
    (training_type = 'group' and gender is not null and level is not null)
    or
    (training_type <> 'group' and gender is null and level is null)
  )
);

-- ── bookings ─────────────────────────────────────────────────────────────────
-- Booking: id, slotId, playerId, creditBatchId, status, bookedAt,
-- cancelledAt (nullable).
create table public.bookings (
  id               text primary key,                    -- bk_…
  slot_id          text not null references public.session_slots (id),
  player_id        text not null references public.players (id),
  credit_batch_id  text not null references public.credit_batches (id),
  status           text not null check (status in ('booked', 'cancelled', 'attended', 'no_show')),
  booked_at        timestamptz not null,
  cancelled_at     timestamptz,
  -- One seat per player per slot. S3d found a real double-spend: a player
  -- re-booked the same slot and burned a second credit, because the booking
  -- RULES deliberately don't inspect existing bookings. Uniqueness is a
  -- CONSTRAINT, not a rule, and it lives here.
  constraint bookings_one_per_player_slot unique (player_id, slot_id),
  -- cancelled_at is set iff the booking is cancelled (entities.ts: "Set when
  -- status becomes cancelled; null otherwise").
  constraint bookings_cancelled_at_shape
    check ((cancelled_at is not null) = (status = 'cancelled'))
);

-- ── indexes (what actually gets queried) ─────────────────────────────────────
-- Slots by week (calendar) and by coach.
create index session_slots_starts_at_idx on public.session_slots (starts_at);
create index session_slots_coach_id_idx on public.session_slots (coach_id);
create index session_slots_template_id_idx on public.session_slots (template_id);
-- Bookings by slot and by player. (player_id is already the prefix of the
-- unique(player_id, slot_id) index, so a standalone player_id index is redundant;
-- slot_id needs its own.)
create index bookings_slot_id_idx on public.bookings (slot_id);
create index bookings_credit_batch_id_idx on public.bookings (credit_batch_id);
-- Batches by player (wallet); purchase_id for the FK / refund lookups.
create index credit_batches_player_id_idx on public.credit_batches (player_id);
create index credit_batches_purchase_id_idx on public.credit_batches (purchase_id);
-- Purchases by player.
create index purchases_player_id_idx on public.purchases (player_id);
create index purchases_package_id_idx on public.purchases (package_id);
-- Templates by coach.
create index availability_templates_coach_id_idx on public.availability_templates (coach_id);
