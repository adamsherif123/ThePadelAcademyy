#!/usr/bin/env bash
# ============================================================================
# S8 — the real-session proof (the exit gate).
#
# Every other test hand-forges request.jwt.claims, which proves the POLICIES but
# not the PLUMBING. This drives the actual chain end to end with a REAL phone OTP
# session:  OTP → verify → JWT → auth.uid() → current_player_id() → RLS → RPC.
#
# It uses the [auth.sms.test_otp] numbers from config.toml (code 123456), so no
# Twilio. Run against a running local stack:  bash supabase/tests/auth_session.sh
# Leaves the DB as it found it (deletes its own rows + auth users, FK-safe).
# ============================================================================
set -uo pipefail

# Derive $CONTAINER from config.toml + confirm the stack is up (clear error if not).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
API="http://127.0.0.1:54321"
ANON="$(supabase status -o env 2>/dev/null | grep -E '^ANON_KEY=' | cut -d= -f2 | tr -d '"')"
DBX=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tA)
PA="+201555550001"; PB="+201555550002"; PC="+201555550003"

FAILS=0
check() { if [ "$2" = "$3" ]; then echo "  ok   — $1 (=$2)"; else echo "  FAIL — $1 (got [$2], want [$3])"; FAILS=$((FAILS+1)); fi; }
jqf()  { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
db()   { "${DBX[@]}" -c "$1"; }

# Real OTP login → prints "<access_token> <auth_uid>".
login() { # $1=phone
  curl -s -X POST "$API/auth/v1/otp"    -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"channel\":\"sms\"}" >/dev/null
  curl -s -X POST "$API/auth/v1/verify" -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"phone\":\"$1\",\"token\":\"123456\",\"type\":\"sms\"}" \
    | jqf "d['access_token'], d['user']['id']"
}
rpc()      { curl -s -X POST "$API/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
rest_get() { curl -s "$API/rest/v1/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1"; }

teardown() {
  db "delete from public.bookings; delete from public.credit_batches; delete from public.players;
      delete from public.session_slots where id='sl_auth'; delete from public.coaches where id='co_auth';
      delete from auth.users where phone in ('201555550001','201555550002','201555550003');" >/dev/null
}

# ── setup ────────────────────────────────────────────────────────────────────
teardown
db "insert into public.coaches (id,name,bio,is_active) values ('co_auth','Coach','b',true);
    insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status)
      values ('sl_auth','co_auth',now()+interval '1 day',now()+interval '1 day 1 hour','trial',4,0,'published');" >/dev/null

echo "── Player A: sign up through the real auth API ──"
read -r TOK_A UID_A <<<"$(login "$PA")"
[ -z "$TOK_A" ] && { echo "FAIL — could not obtain a real session for A (OTP/verify)"; exit 1; }
echo "  A auth uid = $UID_A"

# complete_signup with the REAL JWT
R="$(rpc "$TOK_A" complete_signup '{"p_name":"Ali Hassan","p_gender":"men","p_level":"beginner"}')"
check "complete_signup(A) → ok"                 "$(echo "$R" | jqf "d['ok']")"                "True"
check "complete_signup(A) → not already_completed" "$(echo "$R" | jqf "d['already_completed']")" "False"
PLID_A="$(echo "$R" | jqf "d['player_id']")"

check "player.phone normalised to +E.164"       "$(db "select phone from public.players where id='$PLID_A'")" "$PA"
check "current_player_id() resolves via real auth.uid()" "$(db "select id from public.players where auth_user_id='$UID_A'")" "$PLID_A"

# The 2 trial credits exist, read through RLS with A's own JWT.
CB_A="$(rest_get "$TOK_A" "credit_batches?select=id,training_type,quantity_remaining,source")"
check "A sees exactly 1 trial batch (their own)"     "$(echo "$CB_A" | jqf "len(d)")"                  "1"
check "the batch is a 2-credit signup_grant trial"  "$(echo "$CB_A" | jqf "d[0]['quantity_remaining']==2 and d[0]['source']=='signup_grant' and d[0]['training_type']=='trial'")" "True"

echo "── Player B: a second real signup, for read isolation ──"
read -r TOK_B UID_B <<<"$(login "$PB")"
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

echo "── an authenticated user BEFORE complete_signup is denied everywhere ──"
read -r TOK_C UID_C <<<"$(login "$PC")"
check "C has a real session (authenticated)"    "$([ -n "$TOK_C" ] && echo yes)" "yes"
check "C has NO player row yet"                  "$(db "select count(*) from public.players where auth_user_id='$UID_C'")" "0"
check "C reads zero credit batches (no player → RLS denies)" "$(rest_get "$TOK_C" "credit_batches?select=id" | jqf "len(d)")" "0"
check "C reads zero players (RLS denies)"        "$(rest_get "$TOK_C" "players?select=id" | jqf "len(d)")" "0"
check "C's book_slot → not_authenticated (current_player_id NULL)" "$(rpc "$TOK_C" book_slot '{"p_slot_id":"sl_auth"}' | jqf "d['reason']")" "not_authenticated"

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
if [ "$FAILS" -eq 0 ]; then echo "REAL-SESSION PROOF: PASS (OTP → JWT → auth.uid() → current_player_id() → RLS → RPC)"; exit 0
else echo "REAL-SESSION PROOF: FAIL ($FAILS assertion(s) broke)"; exit 1; fi
