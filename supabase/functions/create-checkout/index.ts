// create-checkout — turns a PENDING purchase into a Paymob checkout URL.
//
// The client already inserted the pending purchase (RLS enforces player_id =
// current_player_id AND amount = the ACTIVE package price — S5.1 test 23; an Edge
// Function inserting as service_role would bypass that proven pin, so we don't).
// This function runs under the CALLER's JWT, so the SELECT below is RLS-scoped: a
// purchase_id that isn't theirs simply isn't found — we never trust the argument.
// The amount handed to Paymob is the DB's, never the client's.
//
// Deployed WITH jwt verification (it needs the caller's identity).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAYMOB_BASE = 'https://accept.paymob.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Fail loudly naming the missing secret (invisible name mismatches — the briefing). */
function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing Edge Function secret: ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Build the specific error OUTSIDE the try so a generic catch can't swallow it.
  let stage = 'init';
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });

    const { purchaseId } = await req.json().catch(() => ({}));
    if (!purchaseId || typeof purchaseId !== 'string') return json(400, { error: 'purchaseId_required' });

    // Caller-scoped client → RLS decides what this user can see.
    stage = 'load_purchase';
    const supa = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: purchase, error: pErr } = await supa
      .from('purchases')
      .select('id, package_id, amount, status')
      .eq('id', purchaseId)
      .maybeSingle();
    if (pErr) return json(500, { error: 'purchase_lookup_failed', detail: pErr.message });
    if (!purchase) return json(404, { error: 'purchase_not_found' }); // not theirs, or gone
    if (purchase.status !== 'pending') return json(409, { error: 'purchase_not_pending' });

    // Billing: use the caller's own player row (RLS self) where we can; NA otherwise.
    const { data: player } = await supa.from('players').select('name, phone').maybeSingle();
    const [firstName, ...rest] = (player?.name ?? 'Padel Player').trim().split(' ');
    const billing = {
      first_name: firstName || 'Padel',
      last_name: rest.join(' ') || 'Player',
      email: 'player@thepadelacademy.eg',
      phone_number: player?.phone ?? '+201000000000',
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', shipping_method: 'NA',
      postal_code: 'NA', city: 'Cairo', country: 'EG', state: 'NA',
    };

    // ── Paymob legacy flow: auth → order → payment key → iframe URL ──
    const apiKey = env('PAYMOB_API_KEY');                 // the wrapped (==) key, used AS-IS
    const integrationId = Number(env('PAYMOB_INTEGRATION_ID'));
    const iframeId = env('PAYMOB_IFRAME_ID');
    const amount = purchase.amount; // integer piastres, from the DB — never the client

    stage = 'paymob_auth';
    const authRes = await fetch(`${PAYMOB_BASE}/api/auth/tokens`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }),
    });
    if (!authRes.ok) return json(502, { error: 'paymob_auth_failed', status: authRes.status, detail: await authRes.text() });
    const token = (await authRes.json()).token as string;

    stage = 'paymob_order';
    // merchant_order_id = our purchase id → the webhook maps the callback straight back.
    const orderRes = await fetch(`${PAYMOB_BASE}/api/ecommerce/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: token, delivery_needed: false, amount_cents: amount, currency: 'EGP', merchant_order_id: purchase.id, items: [] }),
    });
    if (!orderRes.ok) return json(502, { error: 'paymob_order_failed', status: orderRes.status, detail: await orderRes.text() });
    const orderId = (await orderRes.json()).id;

    stage = 'paymob_payment_key';
    const keyRes = await fetch(`${PAYMOB_BASE}/api/acceptance/payment_keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: token, amount_cents: amount, expiration: 3600, order_id: orderId, currency: 'EGP', integration_id: integrationId, billing_data: billing }),
    });
    if (!keyRes.ok) return json(502, { error: 'paymob_payment_key_failed', status: keyRes.status, detail: await keyRes.text() });
    const paymentToken = (await keyRes.json()).token as string;

    const checkoutUrl = `${PAYMOB_BASE}/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;
    return json(200, { checkoutUrl });
  } catch (e) {
    return json(500, { error: 'create_checkout_failed', stage, detail: e instanceof Error ? e.message : String(e) });
  }
});
