// delete-account — in-app account deletion (Apple 5.1.1(v) / Google Play parity).
//
// ORDER MATTERS. The DB work (anonymise the player, cancel future bookings, null the
// auth link) happens FIRST, via a caller-scoped RPC; the auth.users delete happens
// SECOND, via the Admin API. So a failure between them leaves a recoverable state —
// an orphaned auth user detached from an already-anonymised player — NEVER a live
// auth user still holding PII.
//
// The delete_account RPC resolves the caller through auth.uid() and takes NO argument,
// so even this function cannot delete anyone but the JWT's owner. The service_role key
// is used ONLY for auth.admin.deleteUser, and never leaves this runtime.
//
// Deployed WITH jwt verification (it needs the caller's identity).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing Edge Function secret: ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });

    // Caller-scoped client → RLS + auth.uid() see the CALLER, not the service role.
    const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });

    // The verified identity. This uid is the ONLY thing we ever delete.
    const { data: userData, error: userErr } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (userErr || !uid) return json(401, { error: 'unauthorized' });

    // 1) DB first: anonymise + cancel future bookings + null the auth link. The RPC
    //    resolves the caller via auth.uid() — we pass no id.
    const { data: result, error: rpcErr } = await caller.rpc('delete_account');
    if (rpcErr) return json(500, { error: 'delete_failed', detail: rpcErr.message });
    if (result && result.ok === false) {
      // Only reason the RPC returns is not_authenticated (a null uid), which getUser
      // already guards — treat as unauthorized.
      return json(401, { error: result.reason ?? 'unauthorized' });
    }

    // 2) Auth identity second: now that the player is detached (RESTRICT satisfied),
    //    drop the auth.users row via the Admin API. If this fails the account is still
    //    effectively deleted (PII stripped, link nulled); we log the orphan and report
    //    success so the client signs out — a retry/cron can reap the detached user.
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) console.error('auth.admin.deleteUser failed (orphaned auth user)', uid, delErr.message);

    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: 'delete_failed', detail: e instanceof Error ? e.message : String(e) });
  }
});
