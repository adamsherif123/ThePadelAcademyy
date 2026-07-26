-- ============================================================================
-- Quick fix — deleting a recurring rule actually deletes it, and cleanly
-- cancels its future sessions.
--
-- ── TASK 1 (report) — why delete currently no-ops ──
-- Not a backend bug: `availability_templates_admin_delete` + the raw grant
-- already let an admin DELETE a template row. The failure is client-side,
-- three layers deep, and it's a real DB error every time — session_slots.
-- template_id references availability_templates with NO ON DELETE clause
-- (defaults to NO ACTION, i.e. RESTRICT), so deleting a rule that has EVER
-- generated a slot (the common case — a fresh, never-generated rule is the
-- only one a raw DELETE would actually succeed on) throws a 23503 foreign-key
-- violation. That violation IS caught (apps/admin/src/data/queries.ts's
-- runWrite catches every thrown ApiError), but:
--   1. runWrite's catch only special-cases 23P01 (coach conflict); a 23503
--      falls through to the generic {ok:false, reason:'network'} — already a
--      lossy translation of a permanent, not transient, failure.
--   2. apps/admin/src/data/templates.ts's deleteTemplate wrapper drops even
--      that: `return { ok: res.ok }` discards `reason` entirely.
--   3. apps/admin/src/calendar/TemplatesPanel.tsx's DeleteTemplateConfirm
--      never reads the result at all: `await deleteTemplate(id); onClose();`
--      — the modal closes unconditionally, success or failure. Nothing
--      invalidated the query cache (runWrite only does that on the ok path),
--      so the row is exactly where it was — "pressing it does nothing
--      visible" is a precise description of a swallowed FK violation.
-- Sibling check (as asked): `onPause` in the SAME component has the identical
-- shape (`await setTemplateActive(...); onClose();`, result unchecked) —
-- currently low-risk only because a plain is_active UPDATE has no FK to
-- violate, but a genuine network failure there would ALSO silently "succeed".
-- Fixed in the client commit alongside this migration.
--
-- ── TASK 2 — retire, don't hard-delete ──
-- Decision: `deleted_at timestamptz` (mirrors players.deleted_at from S6.x)
-- on availability_templates, not a hard DELETE. Once ANY slot — past or
-- future — has ever referenced a rule, the FK above makes a hard DELETE
-- permanently impossible for that rule, and Task 2 requires past sessions to
-- stay untouched (including their template_id provenance) — so "genuinely
-- deleted" and "past sessions keep their real history" are incompatible for
-- any rule that was ever used. A deleted_at retire is the one shape that's
-- simultaneously honest ("this rule is gone — never generates again, never
-- resurrectable as a pause") and compatible with that constraint, and it
-- gives ONE code path for every rule regardless of whether it ever generated
-- anything (a fresh, ungenerated rule could theoretically hard-delete, but a
-- second path just to exploit that isn't worth it for zero behavioural gain).
-- is_active is force-set false in the same statement so no code path (the
-- generator, the mobile app's operatingWeekdays) mistakes a deleted rule for
-- a merely-paused one; the admin's own template list filters deleted_at
-- rows out client-side (the same convention as players.ts's activePlayers()).
--
-- Atomicity + idempotency: one PL/pgSQL function, one transaction. The
-- template row is locked FIRST (FOR UPDATE) and re-checked for deleted_at —
-- a second call (double-click, or a genuine retry) sees it already retired
-- and returns a clean no-op, never a second pass over the slots. Future
-- slots are locked in id order before cancelling (mirrors delete_account's
-- loop) — defensive consistency with the house discipline, not a proven-
-- necessary fix here: this loop only ever touches ONE template's OWN slots,
-- never a set another concurrent admin action could also be touching in the
-- opposite order (unlike cancel_session×cancel_session's shared-credit-batch
-- race, which is why THAT lock order matters). cancel_session itself is
-- UNTOUCHED — this migration adds no new refund logic; every session it
-- touches is cancelled by calling the existing RPC, one call per slot, so the
-- one mint/refund discipline (S7b.1's credit-batch id ordering, S12's
-- notify) still lives in exactly one place.
-- ============================================================================

alter table public.availability_templates add column deleted_at timestamptz;

-- The admin's raw DELETE path is retired along with the ad-hoc client call —
-- deletion is now exclusively the RPC below, so the direct grant/policy that
-- let a client DELETE the row (and hit the silent FK failure) are removed.
revoke delete on public.availability_templates from authenticated;
drop policy if exists availability_templates_admin_delete on public.availability_templates;

create or replace function public.delete_template(p_template_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_template        public.availability_templates;
  v_slot            record;
  v_cancelled_count int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_template from public.availability_templates where id = p_template_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'template_missing'); end if;

  -- Idempotent: a double-click (or a genuine retry after a dropped response)
  -- sees the rule already retired and does nothing further — no second pass
  -- over the slots, no double refund.
  if v_template.deleted_at is not null then
    return jsonb_build_object('ok', true, 'already_deleted', true, 'cancelled_count', 0);
  end if;

  -- Cancel every FUTURE, not-yet-cancelled session this rule generated —
  -- reusing cancel_session verbatim, one call per slot. It already refunds
  -- every booked player to their original batch at their original expiry
  -- regardless of the 3-hour window (an academy cancellation, never a
  -- forfeit) and notifies them; nothing here re-implements any of that.
  -- Past sessions are excluded by `starts_at > now()` and are never touched —
  -- no row, no refund, no notification for them, ever.
  for v_slot in
    select id from public.session_slots
    where template_id = p_template_id and starts_at > now() and status <> 'cancelled'
    order by id
    for update
  loop
    perform public.cancel_session(v_slot.id);
    v_cancelled_count := v_cancelled_count + 1;
  end loop;

  update public.availability_templates
    set deleted_at = now(), is_active = false
    where id = p_template_id;

  return jsonb_build_object('ok', true, 'already_deleted', false, 'cancelled_count', v_cancelled_count);
end;
$$;

revoke all on function public.delete_template(text) from public;
grant execute on function public.delete_template(text) to authenticated;
