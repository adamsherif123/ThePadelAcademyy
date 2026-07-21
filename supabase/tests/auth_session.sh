#!/usr/bin/env bash
# ============================================================================
# S8 → A2 — the real-session proof (the exit gate).
#
# Every other test hand-forges request.jwt.claims, which proves the POLICIES but
# not the PLUMBING. This drives the actual chain end to end with REAL email/password
# sessions:  signUp/signIn → JWT → auth.uid() → current_player_id() → RLS → RPC.
#
# A2: consumer auth is email + password (phone OTP / Twilio are gone). Email confirmation
# is OFF ([auth.email].enable_confirmations = false), so a fresh signUp yields an immediate
# session. This also proves bug #2 BOTH directions: an admin credential is is_admin=true /
# has no player / complete_signup refused (the consumer app shows the refusal screen), and
# a player is is_admin=false (the admin site refuses them).
#
# Run against a running local stack:  bash supabase/tests/auth_session.sh
# Leaves the DB as it found it (deletes its own rows + auth users, FK-safe).
# ============================================================================
set -uo pipefail

# Derive $CONTAINER from config.toml + confirm the stack is up (clear error if not).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
API="http://127.0.0.1:54321"
ANON="$(supabase status -o env 2>/dev/null | grep -E '^ANON_KEY=' | cut -d= -f2 | tr -d '"')"
SERVICE="$(supabase status -o env 2>/dev/null | grep -E '^SERVICE_ROLE_KEY=' | cut -d= -f2 | tr -d '"')"
DBX=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tA)
EA="a@players.eg"; EB="b@players.eg"; EC="c@players.eg"; EADM="admin@thepadelacademy.eg"; PW="password123"

FAILS=0
check() { if [ "$2" = "$3" ]; then echo "  ok   — $1 (=$2)"; else echo "  FAIL — $1 (got [$2], want [$3])"; FAILS=$((FAILS+1)); fi; }
jqf()  { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
db()   { "${DBX[@]}" -c "$1"; }

# Real email/password signup / signin → prints "<access_token> <auth_uid>".
signup() { curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqf "d.get('access_token',''), (d.get('user') or {}).get('id','')"; }
signin() { curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jqf "d.get('access_token',''), (d.get('user') or {}).get('id','')"; }
rpc()      { curl -s -X POST "$API/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
rest_get() { curl -s "$API/rest/v1/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1"; }

teardown() {
  db "delete from public.bookings; delete from public.credit_batches; delete from public.players;
      delete from public.admins where auth_user_id in (select id from auth.users where email='$EADM');
      delete from public.session_slots where id='sl_auth'; delete from public.coaches where id='co_auth';
      delete from auth.users where email in ('$EA','$EB','$EC','$EADM','phone1@players.eg','phone2@players.eg');" >/dev/null
}
# email_has_account, called UNAUTHENTICATED with only the anon key (the sign-in screen).
anon_has() { curl -s -X POST "$API/rest/v1/rpc/email_has_account" -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"p_email\":\"$1\"}"; }

# ── setup ────────────────────────────────────────────────────────────────────
teardown
db "insert into public.coaches (id,name,bio,is_active) values ('co_auth','Coach','b',true);
    insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status)
      values ('sl_auth','co_auth',now()+interval '1 day',now()+interval '1 day 1 hour','trial',4,0,'published');" >/dev/null

echo "── Player A: sign up through the real email/password API ──"
read -r TOK_A UID_A <<<"$(signup "$EA" "$PW")"
[ -z "$TOK_A" ] && { echo "FAIL — could not obtain a real session for A (signUp)"; exit 1; }
echo "  A auth uid = $UID_A"

# complete_signup with the REAL JWT
R="$(rpc "$TOK_A" complete_signup '{"p_name":"Ali Hassan","p_gender":"men","p_level":"beginner"}')"
check "complete_signup(A) → ok"                 "$(echo "$R" | jqf "d['ok']")"                "True"
check "complete_signup(A) → not already_completed" "$(echo "$R" | jqf "d['already_completed']")" "False"
PLID_A="$(echo "$R" | jqf "d['player_id']")"

check "player.phone is null (email signup — no phone)" "$(db "select coalesce(phone,'<null>') from public.players where id='$PLID_A'")" "<null>"
check "player.email is stored from the auth user (A2.1)" "$(db "select email from public.players where id='$PLID_A'")" "$EA"

# A2.1 routing check, over the real anon-key path (not just a forged claim).
check "email_has_account(A) → true, called unauthenticated with the anon key" "$(anon_has "$EA")" "true"
check "email_has_account(unknown) → false"                                     "$(anon_has "nobody@nowhere.eg")" "false"
check "current_player_id() resolves via real auth.uid()" "$(db "select id from public.players where auth_user_id='$UID_A'")" "$PLID_A"

# The 2 trial credits exist, read through RLS with A's own JWT.
CB_A="$(rest_get "$TOK_A" "credit_batches?select=id,training_type,quantity_remaining,source")"
check "A sees exactly 1 trial batch (their own)"     "$(echo "$CB_A" | jqf "len(d)")"                  "1"
check "the batch is a 2-credit signup_grant trial"  "$(echo "$CB_A" | jqf "d[0]['quantity_remaining']==2 and d[0]['source']=='signup_grant' and d[0]['training_type']=='trial'")" "True"

echo "── Player B: a second real signup, for read isolation ──"
read -r TOK_B UID_B <<<"$(signup "$EB" "$PW")"
RB="$(rpc "$TOK_B" complete_signup '{"p_name":"Bea Nabil","p_gender":"ladies","p_level":"intermediate"}')"
PLID_B="$(echo "$RB" | jqf "d['player_id']")"
check "B completes signup → ok"                 "$(echo "$RB" | jqf "d['ok']")" "True"

# A cannot read B's wallet (RLS), even asking for it by id.
check "A reading their own wallet still sees only 1 batch" "$(rest_get "$TOK_A" "credit_batches?select=id" | jqf "len(d)")" "1"
check "A CANNOT read B's credit batches (RLS isolation)"   "$(rest_get "$TOK_A" "credit_batches?player_id=eq.$PLID_B&select=id" | jqf "len(d)")" "0"
check "A CANNOT read B's player row (RLS isolation)"       "$(rest_get "$TOK_A" "players?id=eq.$PLID_B&select=id" | jqf "len(d)")" "0"

echo "── book_slot on a trial slot, driven by A's real session ──"
BK="$(rpc "$TOK_A" book_slot '{"p_slot_id":"sl_auth"}')"
check "book_slot(sl_auth) as A → ok"           "$(echo "$BK" | jqf "d['ok']")" "True"
check "the slot took one seat"                 "$(db "select booked_count from public.session_slots where id='sl_auth'")" "1"
check "A spent one of the two trial credits"   "$(db "select quantity_remaining from public.credit_batches where player_id='$PLID_A'")" "1"

echo "── idempotency: complete_signup twice is one player, one grant ──"
R2="$(rpc "$TOK_A" complete_signup '{"p_name":"Ignored","p_gender":"ladies","p_level":"intermediate"}')"
check "second complete_signup(A) → already_completed" "$(echo "$R2" | jqf "d['already_completed']")" "True"
check "still exactly ONE player for A's auth uid"     "$(db "select count(*) from public.players where auth_user_id='$UID_A'")" "1"
check "still exactly ONE signup_grant for A"          "$(db "select count(*) from public.credit_batches where player_id='$PLID_A' and source='signup_grant'")" "1"
check "profile was NOT overwritten by the 2nd call"   "$(db "select gender from public.players where id='$PLID_A'")" "men"

echo "── returning player: signInWithPassword re-establishes the session ──"
read -r TOK_A2 UID_A2 <<<"$(signin "$EA" "$PW")"
check "returning sign-in yields a session for the same auth uid" "$UID_A2" "$UID_A"
check "wrong password is rejected (no token)" "$([ -z "$(signin "$EA" "nope-wrong" | cut -d' ' -f1)" ] && echo empty)" "empty"

echo "── an authenticated user BEFORE complete_signup is denied everywhere ──"
read -r TOK_C UID_C <<<"$(signup "$EC" "$PW")"
check "C has a real session (authenticated)"    "$([ -n "$TOK_C" ] && echo yes)" "yes"
check "C has NO player row yet"                  "$(db "select count(*) from public.players where auth_user_id='$UID_C'")" "0"
check "C reads zero credit batches (no player → RLS denies)" "$(rest_get "$TOK_C" "credit_batches?select=id" | jqf "len(d)")" "0"
check "C reads zero players (RLS denies)"        "$(rest_get "$TOK_C" "players?select=id" | jqf "len(d)")" "0"
check "C's book_slot → not_authenticated (current_player_id NULL)" "$(rpc "$TOK_C" book_slot '{"p_slot_id":"sl_auth"}' | jqf "d['reason']")" "not_authenticated"

echo "── optional phone at signup: normalised to +20 E.164, and UNIQUE ──"
read -r TOK_P UID_P <<<"$(signup "phone1@players.eg" "$PW")"
RP="$(rpc "$TOK_P" complete_signup '{"p_name":"Phoney","p_gender":"men","p_level":"beginner","p_phone":"0100 111 2222"}')"
check "signup WITH an optional phone → ok"        "$(echo "$RP" | jqf "d['ok']")" "True"
check "the phone is normalised to +20 E.164"      "$(db "select phone from public.players where auth_user_id='$UID_P'")" "+201001112222"
read -r TOK_Q UID_Q <<<"$(signup "phone2@players.eg" "$PW")"
check "a 2nd player claiming the same number → phone_taken (clean reason)" \
  "$(rpc "$TOK_Q" complete_signup '{"p_name":"Dupe","p_gender":"men","p_level":"beginner","p_phone":"+20 100 111 2222"}' | jqf "d['reason']")" "phone_taken"
check "the phone_taken signup made no player"     "$(db "select count(*) from public.players where auth_user_id='$UID_Q'")" "0"

echo "── bug #2: an ADMIN credential is refused in the consumer flow ──"
# Create the admin OUT-OF-BAND: auth user via the admin API, admins row via SQL (no client path).
ADM_UID="$(curl -s -X POST "$API/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -d "{\"email\":\"$EADM\",\"password\":\"$PW\",\"email_confirm\":true}" | jqf "d.get('id','')")"
db "insert into public.admins (id,auth_user_id,display_name,created_at) values ('adm_auth_sh','$ADM_UID','Adm',now());" >/dev/null
read -r TOK_ADM _ <<<"$(signin "$EADM" "$PW")"
check "admin authenticates at GoTrue"                         "$([ -n "$TOK_ADM" ] && echo yes)" "yes"
check "admin session is is_admin=true (→ refusal screen)"     "$(rpc "$TOK_ADM" is_admin '{}')" "true"
check "admin owns NO player row (→ never profile-setup)"      "$(db "select count(*) from public.players where auth_user_id='$ADM_UID'")" "0"
check "email_has_account(admin) → false (routes to create-account, then refused)" "$(anon_has "$EADM")" "false"
check "admin complete_signup → is_admin (never a player)"     "$(rpc "$TOK_ADM" complete_signup '{"p_name":"X","p_gender":"men","p_level":"beginner"}' | jqf "d['reason']")" "is_admin"

echo "── FK ON DELETE RESTRICT: anonymise-then-delete is the only path ──"
DEL="$(db "delete from auth.users where id='$UID_A'" 2>&1)"
check "deleting A's auth user is BLOCKED while the player references it" "$(echo "$DEL" | grep -c 'foreign key')" "1"
db "update public.players set auth_user_id = null where auth_user_id='$UID_A'" >/dev/null
DEL2="$(db "delete from auth.users where id='$UID_A'" 2>&1; echo "rc=$?")"
check "after nulling the link, the auth user deletes cleanly (financial record kept)" "$(echo "$DEL2" | grep -c 'rc=0')" "1"
check "A's player + its credits survive the auth-user deletion" "$(db "select count(*) from public.players where id='$PLID_A'")" "1"

# ── teardown ─────────────────────────────────────────────────────────────────
teardown
echo
if [ "$FAILS" -eq 0 ]; then echo "REAL-SESSION PROOF: PASS (email/password → JWT → auth.uid() → current_player_id() → RLS → RPC; admin refused)"; exit 0
else echo "REAL-SESSION PROOF: FAIL ($FAILS assertion(s) broke)"; exit 1; fi
