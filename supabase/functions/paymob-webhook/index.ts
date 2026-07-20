// paymob-webhook — the server-to-server callback that SETTLES a purchase.
//
// SECURITY: HMAC is verified BEFORE any database access. A missing/invalid HMAC
// fails closed (401, zero writes). settle_purchase trusts its arguments — atomicity
// and idempotency hold regardless, but AUTHENTICITY is entirely this HMAC check. A
// webhook that settled without verifying would let anyone who learns a purchase id
// mint themselves credits.
//
// The HMAC is computed with pure Web Crypto (SubtleCrypto, native in Deno) — NO
// node:crypto, NO Buffer, NO timingSafeEqual (all of which either don't exist in
// Deno or throw). Node tests would pass on Buffer; the runtime would not. So this
// is verified by DEPLOYING and PROBING, not by testing.
//
// Deploy with --no-verify-jwt: Paymob's callback carries no Supabase JWT.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// The exact, ordered fields Paymob concatenates for the transaction HMAC. Order is
// load-bearing — a single transposition breaks every verification.
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const;

function pick(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Concatenate the fields in order. Booleans → "true"/"false" (String() gives that); null/undefined → "". */
function hmacString(obj: Record<string, unknown>): string {
  return HMAC_FIELDS.map((f) => {
    const v = pick(obj, f);
    return v == null ? '' : String(v);
  }).join('');
}

async function computeHmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex compare — pure JS, no Buffer / timingSafeEqual. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing Edge Function secret: ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  const url = new URL(req.url);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('bad_json', { status: 400 });
  }
  const obj = (body.obj ?? {}) as Record<string, unknown>;
  // Paymob sends the hmac as a query param on the processed callback; some setups
  // put it in the body. Accept either.
  const provided = (url.searchParams.get('hmac') ?? (body.hmac as string | undefined) ?? '').toLowerCase();

  // ── 1. Verify HMAC FIRST — before any DB access. Fail closed. ──
  let expected: string;
  try {
    expected = await computeHmacHex(hmacString(obj), env('PAYMOB_HMAC'));
  } catch (e) {
    // A misconfigured secret is not an auth pass — reject.
    return new Response(`config_error: ${e instanceof Error ? e.message : e}`, { status: 500 });
  }
  if (!provided || !constantTimeEqual(expected, provided)) {
    return new Response('invalid_hmac', { status: 401 }); // zero DB access happened
  }

  // ── 2. Authenticated. Record the TERMINAL outcome, idempotently. ──
  // success=true              → settle_purchase (pending → succeeded, mints).
  // success=false, pending=false → fail_purchase (pending → failed, mints NOTHING).
  // success=false, pending=true  → a mid-flight state (e.g. "Pending 3DS
  //   Authorization"); NOT terminal — do nothing, leave it pending, let the poll wait.
  // Both RPCs are service_role-only, atomic, idempotent, and guarded on
  // status='pending', so redelivery and out-of-order callbacks are safe.
  const order = (obj.order ?? {}) as Record<string, unknown>;
  const purchaseId = order.merchant_order_id as string | undefined; // = our pu_ id
  const txnId = obj.id != null ? String(obj.id) : null;

  const rpc = obj.success === true
    ? 'settle_purchase'
    : obj.success === false && obj.pending === false
      ? 'fail_purchase'
      : null;

  if (rpc) {
    if (purchaseId && txnId) {
      // service_role client — SUPABASE_SERVICE_ROLE_KEY is auto-injected into Edge
      // Functions and never leaves this runtime (not in a commit, not in either app).
      const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
      const { error } = await admin.rpc(rpc, {
        p_purchase_id: purchaseId,
        p_gateway_transaction_id: txnId,
      });
      // Both RPCs are idempotent (already_settled / already_failed, no error). We
      // still 200 on an RPC error so Paymob doesn't retry forever on a bad row; the
      // detail is logged for reconciliation.
      if (error) console.error(`${rpc} failed`, purchaseId, error.message);
    } else {
      console.error('webhook: verified but missing merchant_order_id/id', JSON.stringify(order));
    }
  }

  // Always 200 once HMAC-verified, so Paymob stops re-delivering.
  return new Response('ok', { status: 200 });
});
