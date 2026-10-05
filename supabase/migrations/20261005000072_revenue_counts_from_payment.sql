-- ============================================================================
-- S-072 — revenue is counted on the day the money was COLLECTED, not the day
-- the sale was recorded.
--
-- A player requests credits on 30 September. The admin takes the cash on
-- 1 October and ticks Paid. Until now that 600 EGP landed in SEPTEMBER's
-- revenue, because every revenue figure buckets on purchases.created_at — the
-- moment the request was approved. The academy counted money it had not yet
-- been given, in a month that had already closed.
--
-- WHY NOT JUST MOVE created_at
-- Because created_at is the only record of when the sale happened. Rewriting it
-- would tell the player, in their own purchase history, that they bought
-- something on a day they did not; it would reorder "recent purchases"; and it
-- would destroy the one fact that lets anyone ever ask how long a request sat
-- unpaid. A purchase has two dates and always did — this migration stops
-- pretending otherwise and writes the second one down.
--
-- THREE PARTS
--   paid_at     when the academy confirmed it had the money. Null until then.
--   revenue_at  the date revenue counts on: coalesce(paid_at, created_at).
--               GENERATED, so no query can disagree with any other about which
--               date it means, and no future writer can forget to maintain it.
--   set_purchase_paid stamps paid_at on the way in and clears it on the way out.
--
-- SAFE FOR THE SHIPPED APPS. Both columns are additive and nullable-or-derived;
-- `authenticated` holds TABLE-level select on purchases, so 1.2, 1.3 and 1.4 —
-- none of which can ever be updated — keep working unchanged. They map columns
-- by name and ignore ones they have never heard of, and the only client INSERT
-- into purchases names its columns explicitly, so the generated column cannot
-- break it. No status, source or notification-type value changes.
-- ============================================================================

-- ── 1. paid_at ───────────────────────────────────────────────────────────────
alter table public.purchases add column if not exists paid_at timestamptz;

comment on column public.purchases.paid_at is
  'When the academy confirmed it COLLECTED this money (set by set_purchase_paid). '
  'Null while unpaid. Revenue is counted on this date, not created_at — see revenue_at.';

-- Backfill: every purchase already marked paid keeps the revenue month it has
-- today. This migration must not move a single historical figure — the point is
-- to change where FUTURE payments land, and a backfill to now() would sweep
-- every past sale into October.
update public.purchases set paid_at = created_at where paid and paid_at is null;

-- ── 2. revenue_at ────────────────────────────────────────────────────────────
-- Generated rather than maintained. The admin filters a month server-side and
-- then does the month arithmetic again in the browser; if those two used
-- hand-rolled coalesces they could drift, and a revenue figure that disagrees
-- with the list under it is worse than one that is simply wrong. One expression,
-- in one place, that nothing can forget to update.
--
-- An unpaid purchase keeps created_at here, which is what the "latest sales"
-- feed needs: it lists sales whether or not the money has arrived.
alter table public.purchases
  add column if not exists revenue_at timestamptz
  generated always as (coalesce(paid_at, created_at)) stored;

comment on column public.purchases.revenue_at is
  'The date revenue counts on: paid_at once collected, created_at before that. '
  'Generated — never written directly.';

-- The Dashboard fetches one month at a time and filters on exactly this column.
create index if not exists purchases_revenue_at_idx on public.purchases (revenue_at);

-- ── 3. set_purchase_paid stamps it ───────────────────────────────────────────
-- Byte-for-byte the function 071 restored, plus the one assignment: `paid_at`
-- moves with `paid` in the same UPDATE, so the two can never disagree. Clearing
-- it on un-paying matters as much as setting it: an admin who ticks Paid by
-- mistake in October and unticks it must not leave an October stamp behind on a
-- purchase that is once again uncollected.
--
-- now(), not a caller-supplied date: this records when the academy said it had
-- the money, and that is the moment the button was pressed. An admin backdating
-- a collection is a different feature with a different audit story.
create or replace function public.set_purchase_paid(p_purchase_id text, p_paid boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
  v_paid   boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_paid is null then return jsonb_build_object('ok', false, 'reason', 'invalid_paid'); end if;

  select status, paid into v_status, v_paid from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;
  if v_status <> 'succeeded' then return jsonb_build_object('ok', false, 'reason', 'not_succeeded'); end if;

  if v_paid = p_paid then
    return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', false);
  end if;

  update public.purchases
     set paid    = p_paid,
         paid_at = case when p_paid then now() else null end
   where id = p_purchase_id;
  return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', true);
end;
$$;

-- 071's grants, unchanged and restated so this file is the whole truth about the
-- function it replaces. Production's ALTER DEFAULT PRIVILEGES would otherwise
-- hand anon EXECUTE on a newly-created function; create-or-replace keeps the
-- existing ACL, but stating it costs nothing and survives a future recreate.
revoke all on function public.set_purchase_paid(text, boolean) from public, anon, service_role;
grant execute on function public.set_purchase_paid(text, boolean) to authenticated;

-- ── 4. assert what we just did ───────────────────────────────────────────────
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='purchases' and column_name in ('paid_at','revenue_at');
  if n <> 2 then raise exception '072: expected both columns, found %', n; end if;

  -- Every paid purchase has a stamp, so no historical revenue moved.
  select count(*) into n from public.purchases where paid and paid_at is null;
  if n <> 0 then raise exception '072: % paid purchase(s) left without paid_at', n; end if;

  -- And revenue_at agrees with the old behaviour for everything that exists now.
  select count(*) into n from public.purchases where revenue_at <> coalesce(paid_at, created_at);
  if n <> 0 then raise exception '072: revenue_at disagrees on % row(s)', n; end if;

  select count(*) into n from public.purchases where not paid and paid_at is not null;
  if n <> 0 then raise exception '072: % unpaid purchase(s) carry a paid_at', n; end if;

  raise notice '072: revenue now counts from paid_at; % purchase(s) backfilled to created_at',
    (select count(*) from public.purchases where paid);
end $$;
