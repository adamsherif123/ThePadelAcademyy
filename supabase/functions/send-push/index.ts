// send-push — fired by the notifications-insert trigger (pg_net). Looks up the
// recipient's device tokens and delivers the notification through the Expo Push API,
// pruning tokens Expo reports as DeviceNotRegistered.
//
// AUTH: this is an internal target, not user-facing, so it's deployed --no-verify-jwt
// and instead requires a shared secret header (x-trigger-secret) that only the DB
// trigger knows. It uses the auto-injected SUPABASE_SERVICE_ROLE_KEY to read tokens
// and claim the row — that key never leaves this runtime.
//
// IDEMPOTENT: it CLAIMS the notification first via a guarded UPDATE
// (set pushed_at where pushed_at is null); a webhook retry finds 0 rows and skips, so
// it never double-sends. The in-app notification row is the durable record regardless.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing Edge Function secret: ${name}`);
  return v;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Shared-secret gate — the trigger is the only caller that knows it.
  if (req.headers.get('x-trigger-secret') !== env('PUSH_TRIGGER_SECRET')) {
    return json(401, { error: 'unauthorized' });
  }

  let notificationId: string | undefined;
  try {
    notificationId = (await req.json())?.notification_id;
  } catch {
    return json(400, { error: 'bad_json' });
  }
  if (!notificationId) return json(400, { error: 'notification_id_required' });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // CLAIM the row (idempotency guard). Only the first delivery attempt gets it.
  const { data: claimed, error: claimErr } = await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('pushed_at', null)
    .select('id, player_id, type, title, body, slot_id')
    .maybeSingle();
  if (claimErr) return json(500, { error: 'claim_failed', detail: claimErr.message });
  if (!claimed) return json(200, { ok: true, skipped: 'already_pushed_or_missing' });

  // The recipient's device tokens.
  const { data: tokens, error: tokErr } = await admin
    .from('device_push_tokens')
    .select('id, expo_push_token')
    .eq('player_id', claimed.player_id);
  if (tokErr) return json(500, { error: 'tokens_lookup_failed', detail: tokErr.message });
  if (!tokens || tokens.length === 0) return json(200, { ok: true, sent: 0, reason: 'no_tokens' });

  // One Expo message per token.
  const messages = tokens.map((t) => ({
    to: t.expo_push_token,
    title: claimed.title,
    body: claimed.body,
    data: { notificationId: claimed.id, type: claimed.type, slotId: claimed.slot_id },
  }));

  const expoRes = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  const expoBody = await expoRes.json().catch(() => null);
  if (!expoRes.ok) {
    return json(502, { error: 'expo_push_failed', status: expoRes.status, detail: expoBody });
  }

  // Tickets come back in the same order as the messages. Prune any token Expo says is
  // no longer registered (uninstall / token rotation).
  const tickets: Array<{ status?: string; details?: { error?: string } }> = expoBody?.data ?? [];
  const toPrune: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
      toPrune.push(tokens[i].expo_push_token);
    }
  });
  if (toPrune.length > 0) {
    await admin.from('device_push_tokens').delete().in('expo_push_token', toPrune);
  }

  const okCount = tickets.filter((t) => t?.status === 'ok').length;
  return json(200, { ok: true, sent: okCount, pruned: toPrune.length, tickets });
});
