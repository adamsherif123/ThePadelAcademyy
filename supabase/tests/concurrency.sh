#!/usr/bin/env bash
# ============================================================================
# S7a — the concurrency proof (the exit gate).
#
# pgTAP is single-session, so it CANNOT prove the atomic guarantee. This opens N
# real, separate connections that call book_slot on the SAME slot at the same
# wall-clock instant, and asserts the invariant the whole session exists for:
#   * capacity-1 slot, 8 racers      → exactly 1 books, booked_count=1, 1 credit spent
#   * capacity-4 slot, 10 racers     → exactly 4 book,  booked_count=4, 4 credits spent
#   * one player, 1 credit, 2 slots  → exactly 1 books (the credit guard is a
#                                       different lock from the seat guard)
#
# Contention is forced: every racer sleeps until a shared target instant, then
# fires book_slot together, so they pile onto the same row lock.
#
# Run against the local dev DB:  bash supabase/tests/concurrency.sh
# Leaves the DB as it found it (teardown deletes only its own rows).
# ============================================================================
set -uo pipefail

# Derive $CONTAINER from config.toml + confirm the stack is up (clear error if not).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Run SQL from stdin as the superuser (RLS bypassed) and return trimmed output.
sql() { "${PSQL[@]}" -c "$1"; }
# Run a racer in its own connection: assume the player's JWT, wait for the shared
# target, then book. Emits exactly WIN or LOSE (nothing else prints that token).
racer() { # $1=uuid $2=slot $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select case when (public.book_slot('$2')->>'ok')='true' then 'WIN' else 'LOSE' end" \
    > "$4" 2>&1 &
}

# A racer that CANCELS a session as the admin (for the book-vs-cancel race).
racer_cancel() { # $1=admin_uuid $2=slot $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select public.cancel_session('$2')->>'ok'" \
    > "$4" 2>&1 &
}

# A racer that APPROVES a credit request as the admin (A3 — the new mint path). Authorises
# via is_admin() on the JWT claim, so no `set role` is needed (definer RPC).
racer_approve() { # $1=admin_uuid $2=request_id $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select public.approve_credit_request('$2')->>'ok'" \
    > "$4" 2>&1 &
}

# Booking rework (Task 4) — a racer that books an UNTYPED slot with an explicit
# chosen type. Emits 'WIN' on ok:true, else the RPC's reason string (type_mismatch,
# slot_full, no_usable_credit, ...) — unlike racer(), we need the actual reason to
# tell "lost to a different type" apart from "lost on capacity".
racer_book_typed() { # $1=uuid $2=slot $3=training_type $4=target_iso $5=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$4' - clock_timestamp()))))" \
    -c "select coalesce(public.book_slot('$2','$3')->>'reason', 'WIN')" \
    > "$5" 2>&1 &
}

# A racer that cancels a player's OWN booking (self-cancel, not admin) — for the
# revert-vs-new-booking race (Task 3's race-safety).
racer_cancel_own() { # $1=player_uuid $2=booking_id $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select public.cancel_booking('$2')->>'ok'" \
    > "$4" 2>&1 &
}

# A racer that deletes a player's OWN account (for the delete_account-vs-
# cancel_booking race on the SAME booking).
racer_delete_account() { # $1=player_uuid $2=target_iso $3=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$2' - clock_timestamp()))))" \
    -c "select public.delete_account()->>'ok'" \
    > "$3" 2>&1 &
}

# A racer that deletes a PACKAGE as the admin (for the delete_package-vs-
# request_credits race). Wraps the single call in a subquery so the result is
# read once, never invoked twice by the formatting itself.
racer_delete_package() { # $1=admin_uuid $2=package_id $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select case when (r->>'ok')='true' then coalesce(r->>'action','ok') else r->>'reason' end from (select public.delete_package('$2') as r) s" \
    > "$4" 2>&1 &
}

# A racer that submits a credit REQUEST as a player (for the delete_package-vs-
# request_credits race — request_credits inserts into credit_requests, which
# FK-references packages, same as record_cash_purchase's purchases insert).
racer_request_credits() { # $1=player_uuid $2=package_id $3=target_iso $4=outfile
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "select pg_sleep(greatest(0, extract(epoch from (timestamptz '$3' - clock_timestamp()))))" \
    -c "select case when (r->>'ok')='true' then 'true' else r->>'reason' end from (select public.request_credits('$2','instapay') as r) s" \
    > "$4" 2>&1 &
}

# A one-off, non-raced call as a given player — used to set up pre-race state
# (e.g. Scenario H's "X already booked" precondition) without contention.
call_as() { # $1=uuid $2=sql
  "${PSQL[@]}" \
    -c "set role authenticated" \
    -c "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false)" \
    -c "$2"
}

uuid() { printf '00000000-0000-0000-0000-%012d' "$1"; }  # deterministic test uuids

FAILS=0
check() { # $1=label $2=got $3=want
  if [ "$2" = "$3" ]; then echo "  ok   — $1 (=$2)"; else echo "  FAIL — $1 (got $2, want $3)"; FAILS=$((FAILS+1)); fi
}

cleanup_rows() {
  # book_slot mints bookings with 'bk_<uuid>' ids, so delete bookings by their
  # slot/player, not by an id prefix (FK-safe order: bookings → batches → slots → players → coaches).
  sql "delete from public.notifications   where slot_id like 'slr_%' or player_id like 'plr_%';
       delete from public.bookings        where slot_id like 'slr_%' or player_id like 'plr_%';
       delete from public.credit_batches  where id like 'cbr_%' or player_id like 'plr_%';
       delete from public.credit_requests where player_id like 'plr_%';
       delete from public.purchases       where player_id like 'plr_%';
       delete from public.session_slots   where id like 'slr_%';
       delete from public.packages        where id like 'pkr_%';
       delete from public.players         where id like 'plr_%';
       delete from public.admins          where id like 'adr_%';
       delete from public.coaches         where id like 'cor_%';
       delete from auth.users             where id::text like '00000000-0000-0000-0000-%';" >/dev/null
}

# ── setup ────────────────────────────────────────────────────────────────────
cleanup_rows
SETUP="insert into public.coaches (id,name,bio,is_active) values
  ('cor_a','C','b',true),('cor_b','C','b',true),('cor_c1','C','b',true),('cor_c2','C','b',true);
insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values
  ('slr_a','cor_a',   now()+interval '1 day', now()+interval '1 day 1 hour','trial',1,0,'published'),
  ('slr_b','cor_b',   now()+interval '1 day', now()+interval '1 day 1 hour','trial',4,0,'published'),
  ('slr_c1','cor_c1', now()+interval '1 day', now()+interval '1 day 1 hour','trial',4,0,'published'),
  ('slr_c2','cor_c2', now()+interval '1 day', now()+interval '1 day 1 hour','trial',4,0,'published');"

# Scenario A players (8) + B players (10), each with one trial credit.
# S8: auth_user_id FK-references auth.users, and the JWT sub must resolve via it —
# so each racer's auth.users row is seeded (id-only) before its player.
for i in $(seq 1 8);  do SETUP+="insert into auth.users (id) values ('$(uuid $((100+i)))');"; SETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_a$i','+2010000${i}1','A','men','beginner',now(),'$(uuid $((100+i)))');"; SETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_a$i','plr_a$i','signup_grant',null,'trial',1,1,now()+interval '30 day',now());"; done
for i in $(seq 1 10); do SETUP+="insert into auth.users (id) values ('$(uuid $((200+i)))');"; SETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_b$i','+2010000${i}2','B','men','beginner',now(),'$(uuid $((200+i)))');"; SETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_b$i','plr_b$i','signup_grant',null,'trial',1,1,now()+interval '30 day',now());"; done
# Scenario C: one player, ONE credit, two slots.
SETUP+="insert into auth.users (id) values ('$(uuid 301)');"
SETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_c1','+201000099','C','men','beginner',now(),'$(uuid 301)');"
SETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_c1','plr_c1','signup_grant',null,'trial',1,1,now()+interval '30 day',now());"
sql "$SETUP" >/dev/null

target() { date -u -v+"$1"S +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d "+$1 seconds" +%Y-%m-%dT%H:%M:%S; }

# ── Scenario A: capacity-1, 8 racers → exactly one wins ──────────────────────
echo "Scenario A — capacity-1 slot, 8 concurrent racers:"
T=$(target 4)
for i in $(seq 1 8); do racer "$(uuid $((100+i)))" slr_a "$T" "$TMP/a_$i.txt"; done
wait
WINS_A=$(grep -lFx WIN "$TMP"/a_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "exactly one racer booked"        "$WINS_A" "1"
check "booked_count = 1 (no oversell)"  "$(sql "select booked_count from public.session_slots where id='slr_a'")" "1"
check "exactly one booking row"         "$(sql "select count(*) from public.bookings where slot_id='slr_a' and status<>'cancelled'")" "1"
check "exactly one credit spent"        "$(sql "select coalesce(sum(quantity_total-quantity_remaining),0) from public.credit_batches where id like 'cbr_a%'")" "1"

# ── Scenario B: capacity-4, 10 racers → exactly four win ─────────────────────
echo "Scenario B — capacity-4 slot, 10 concurrent racers:"
T=$(target 4)
for i in $(seq 1 10); do racer "$(uuid $((200+i)))" slr_b "$T" "$TMP/b_$i.txt"; done
wait
WINS_B=$(grep -lFx WIN "$TMP"/b_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "exactly four racers booked"      "$WINS_B" "4"
check "booked_count = 4 (no oversell)"  "$(sql "select booked_count from public.session_slots where id='slr_b'")" "4"
check "exactly four booking rows"       "$(sql "select count(*) from public.bookings where slot_id='slr_b' and status<>'cancelled'")" "4"
check "exactly four credits spent"      "$(sql "select coalesce(sum(quantity_total-quantity_remaining),0) from public.credit_batches where id like 'cbr_b%'")" "4"

# ── Scenario C: one credit, two slots → exactly one win ──────────────────────
echo "Scenario C — one player, one credit, two slots raced at once:"
T=$(target 4)
racer "$(uuid 301)" slr_c1 "$T" "$TMP/c_1.txt"
racer "$(uuid 301)" slr_c2 "$T" "$TMP/c_2.txt"
wait
WINS_C=$(grep -lFx WIN "$TMP"/c_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "exactly one of the two slots booked" "$WINS_C" "1"
check "the single credit was spent once"    "$(sql "select quantity_total-quantity_remaining from public.credit_batches where id='cbr_c1'")" "1"
check "exactly one booking for the player"  "$(sql "select count(*) from public.bookings where player_id='plr_c1' and status<>'cancelled'")" "1"

# ── Scenario D: book_slot vs cancel_session on the SAME slot (S7b Task 0) ─────
# The dangerous ordering: cancel_session commits first, refunds everyone it sees,
# then the player's guarded increment must NOT slip a booking in after the refund
# pass. The fix (status='published' in the guarded WHERE) makes that increment
# match zero rows. We race K slots, each with a booking player AND the admin
# cancelling at the same instant, and assert NO orphan survives in EITHER ordering:
# no active booking on a cancelled slot, and no net credit spent (a booking that
# landed was refunded by cancel_session).
echo "Scenario D — book_slot vs cancel_session raced on the same slot (K=40):"
D_N=40
DSETUP="insert into auth.users (id) values ('$(uuid 999)');"
# A1: the cancelling admin is an admins row, NOT a player — is_admin() reads admins.
DSETUP+="insert into public.admins (id,auth_user_id,display_name,created_at) values ('adm_dadm','$(uuid 999)','Adm',now());"
for i in $(seq 1 $D_N); do
  DSETUP+="insert into public.coaches (id,name,bio,is_active) values ('cor_d$i','C','b',true);"
  DSETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_d$i','cor_d$i',now()+interval '1 day',now()+interval '1 day 1 hour','trial',4,0,'published');"
  DSETUP+="insert into auth.users (id) values ('$(uuid $((400+i)))');"
  DSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_d$i','+2010009${i}','D','men','beginner',now(),'$(uuid $((400+i)))');"
  DSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_d$i','plr_d$i','signup_grant',null,'trial',1,1,now()+interval '30 day',now());"
done
sql "$DSETUP" >/dev/null

T=$(target 5)
for i in $(seq 1 $D_N); do
  racer        "$(uuid $((400+i)))" "slr_d$i" "$T" "$TMP/d_book_$i.txt"
  racer_cancel "$(uuid 999)"        "slr_d$i" "$T" "$TMP/d_cxl_$i.txt"
done
wait
# THE invariant, tolerant of the rare book/cancel deadlock (which aborts one side
# cleanly, leaving the slot published and the booking legitimate — NOT an orphan):
#  (1) no LIVE booking on a CANCELLED slot, and
#  (2) no credit spent on a booking whose session ended cancelled (all refunded).
# A booking on a still-published slot (a deadlocked cancel) is legitimate, so we
# don't require every slot to end cancelled.
D_ORPHAN=$(sql "select count(*) from public.bookings b join public.session_slots s on b.slot_id=s.id
                where s.id like 'slr_d%' and b.status='booked' and s.status='cancelled'")
D_LOST=$(sql "select count(*) from public.credit_batches cb
              where cb.id like 'cbr_d%' and cb.quantity_remaining < 1
                and (select status from public.session_slots where id='slr_d'||substr(cb.id,6))='cancelled'")
D_CANCELLED=$(sql "select count(*) from public.session_slots where id like 'slr_d%' and status='cancelled'")
D_REFUNDED=$(sql "select count(*) from public.bookings where slot_id like 'slr_d%' and status='cancelled'")
D_DEADLOCK=$(grep -rl "deadlock detected" "$TMP"/d_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "no live booking on any cancelled slot (no orphan)"          "$D_ORPHAN"   "0"
check "no credit lost on a cancelled session (every one refunded)" "$D_LOST"     "0"
check "zero deadlocks (book_slot vs cancel_session serialise on the slot row)" "$D_DEADLOCK" "0"
echo "  info — $D_CANCELLED/$D_N slots cancelled; $D_REFUNDED booking(s) landed-then-refunded (proves both orderings raced)"

# ── Scenario E: cancel_session × cancel_session sharing credit batches (S7b.1) ──
# The REAL money-path deadlock: two admins cancel two different sessions that share
# players, so both refund the SAME credit_batches. cancel_session is the only
# multi-refund RPC, and before S7b.1 it locked those credits in booking-scan order —
# two cancels with an overlapping set in opposite order would cycle (reproduced ~5/6
# rounds). The fix refunds in credit_batch_id order, so shared credit locks are
# always taken in one global order and no cycle can form. Here each pair books 8
# shared players onto slot X in order 1..8 and onto slot Y in order 8..1 (forcing the
# opposite lock order), then races cancel(X) vs cancel(Y). Assert ZERO deadlocks and
# that BOTH cancels fully refunded (every shared credit ends at 2 → both refunds ran).
echo "Scenario E — cancel_session × cancel_session on shared credits, opposite order (KE=20 pairs):"
E_KE=20
ESETUP=""
for k in $(seq 1 $E_KE); do
  ESETUP+="insert into public.coaches (id,name,bio,is_active) values ('cor_ex$k','C','b',true),('cor_ey$k','C','b',true);"
  ESETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_ex$k','cor_ex$k',now()+interval '1 day',now()+interval '1 day 1 hour','trial',8,8,'published'),('slr_ey$k','cor_ey$k',now()+interval '1 day',now()+interval '1 day 1 hour','trial',8,8,'published');"
  for p in $(seq 1 8); do
    ESETUP+="insert into public.players (id,phone,name,gender,level,created_at) values ('plr_e${k}_${p}','+201e${k}x${p}','E','men','beginner',now());"
    ESETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_e${k}_${p}','plr_e${k}_${p}','signup_grant',null,'trial',2,0,now()+interval '30 day',now());"
  done
  for p in 1 2 3 4 5 6 7 8; do ESETUP+="insert into public.bookings (id,slot_id,player_id,credit_batch_id,status,booked_at) values ('bkr_ex${k}_${p}','slr_ex$k','plr_e${k}_${p}','cbr_e${k}_${p}','booked',now());"; done
  for p in 8 7 6 5 4 3 2 1; do ESETUP+="insert into public.bookings (id,slot_id,player_id,credit_batch_id,status,booked_at) values ('bkr_ey${k}_${p}','slr_ey$k','plr_e${k}_${p}','cbr_e${k}_${p}','booked',now());"; done
done
sql "$ESETUP" >/dev/null

T=$(target 5)
for k in $(seq 1 $E_KE); do
  racer_cancel "$(uuid 999)" "slr_ex$k" "$T" "$TMP/e_x_$k.txt"
  racer_cancel "$(uuid 999)" "slr_ey$k" "$T" "$TMP/e_y_$k.txt"
done
wait
E_DEADLOCK=$(grep -rl "deadlock detected" "$TMP"/e_*.txt 2>/dev/null | wc -l | tr -d ' ')
E_CANCELLED=$(sql "select count(*) from public.session_slots where id like 'slr_e%' and status='cancelled'")
E_UNREFUNDED=$(sql "select count(*) from public.credit_batches where id like 'cbr_e%' and quantity_remaining <> 2")
check "zero deadlocks (cancel×cancel refund credits in one global order)" "$E_DEADLOCK"   "0"
check "all $((2*E_KE)) sessions cancelled (no cancel aborted)"            "$E_CANCELLED"   "$((2*E_KE))"
check "every shared credit refunded by BOTH cancels (ends at 2/2)"       "$E_UNREFUNDED"  "0"

# ── Scenario F: approve_credit_request raced — the A3 mint path mints ONCE ──────
# Two concurrent approvals hit the SAME pending request. The FOR UPDATE lock serialises
# them; the loser sees status='approved' and mints nothing. Assert exactly one purchase +
# one purchase-backed batch per request (no double-mint), and every request approved.
echo "Scenario F — approve_credit_request raced (2 concurrent approves per request, K=20):"
F_K=20
FSETUP="insert into auth.users (id) values ('$(uuid 999)') on conflict do nothing;"
# uuid 999 is already the admin from Scenario D; re-assert idempotently.
FSETUP+="insert into public.admins (id,auth_user_id,display_name,created_at) values ('adr_f','$(uuid 999)','Adm',now()) on conflict (auth_user_id) do nothing;"
FSETUP+="insert into public.packages (id,training_type,session_count,price,name,is_active) values ('pkr_f','group',8,280000,'F8',true);"
for k in $(seq 1 $F_K); do
  FSETUP+="insert into auth.users (id) values ('$(uuid $((500+k)))');"
  FSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_f$k','+2010f55${k}','F','men','beginner',now(),'$(uuid $((500+k)))');"
  FSETUP+="insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at) values ('crr_f$k','plr_f$k','pkr_f','instapay','pending',now());"
done
sql "$FSETUP" >/dev/null

T=$(target 5)
for k in $(seq 1 $F_K); do
  racer_approve "$(uuid 999)" "crr_f$k" "$T" "$TMP/f_a_$k.txt"
  racer_approve "$(uuid 999)" "crr_f$k" "$T" "$TMP/f_b_$k.txt"
done
wait
F_APPROVED=$(sql "select count(*) from public.credit_requests where player_id like 'plr_f%' and status='approved'")
F_PURCH=$(sql "select count(*) from public.purchases where player_id like 'plr_f%'")
F_BATCH=$(sql "select count(*) from public.credit_batches where player_id like 'plr_f%' and source='purchase'")
F_CREDITS=$(sql "select coalesce(sum(quantity_total),0) from public.credit_batches where player_id like 'plr_f%'")
check "every request approved (K=$F_K)"                        "$F_APPROVED" "$F_K"
check "exactly ONE purchase per request (no double-mint)"      "$F_PURCH"    "$F_K"
check "exactly ONE purchase-backed batch per request"          "$F_BATCH"    "$F_K"
check "total credits minted = K×8 (each request mints once)"   "$F_CREDITS"  "$((F_K*8))"

# ── Scenario G: two concurrent approvals of a TRIAL request → exactly one (A5) ──
# The once-per-player trial must hold under real parallelism: each player has ONE pending
# trial request; two admins approve it at the same instant. The FOR UPDATE lock serialises
# them (loser → already_resolved) and index B (one trial-purchase batch per player) is the
# ultimate backstop — so exactly one trial credit is minted per player, never two.
echo "Scenario G — two concurrent TRIAL approvals per player, once-per-player holds (K=20):"
G_K=20
GSETUP="insert into auth.users (id) values ('$(uuid 999)') on conflict do nothing;"
GSETUP+="insert into public.admins (id,auth_user_id,display_name,created_at) values ('adr_f','$(uuid 999)','Adm',now()) on conflict (auth_user_id) do nothing;"
GSETUP+="insert into public.packages (id,training_type,session_count,price,name,is_active) values ('pkr_gtrial','trial',1,50000,'GTrial',true);"
for k in $(seq 1 $G_K); do
  GSETUP+="insert into auth.users (id) values ('$(uuid $((600+k)))');"
  GSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_g$k','+2010g55${k}','G','men','beginner',now(),'$(uuid $((600+k)))');"
  GSETUP+="insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at,is_trial) values ('crg_$k','plr_g$k','pkr_gtrial','instapay','pending',now(),true);"
done
sql "$GSETUP" >/dev/null

T=$(target 5)
for k in $(seq 1 $G_K); do
  racer_approve "$(uuid 999)" "crg_$k" "$T" "$TMP/g_a_$k.txt"
  racer_approve "$(uuid 999)" "crg_$k" "$T" "$TMP/g_b_$k.txt"
done
wait
G_BATCH=$(sql "select count(*) from public.credit_batches where player_id like 'plr_g%' and training_type='trial' and source='purchase'")
G_CREDITS=$(sql "select coalesce(sum(quantity_total),0) from public.credit_batches where player_id like 'plr_g%'")
G_PURCH=$(sql "select count(*) from public.purchases where player_id like 'plr_g%'")
check "exactly ONE trial batch per player (K=$G_K, once-per-player under contention)" "$G_BATCH"   "$G_K"
check "exactly ONE trial purchase per player (no double-mint)"                        "$G_PURCH"   "$G_K"
check "total trial credits minted = K×1 (never two per player)"                       "$G_CREDITS" "$G_K"

# ── Scenario H: revert (self-cancel emptying a booking-set slot) racing a NEW,
# differently-typed booking (Task 3's race-safety claim) ─────────────────────
# X books an untyped slot as 'individual' (this sets training_type='individual',
# forces capacity 1, and stashes the ORIGINAL capacity (3) in pre_booking_capacity
# — done first, un-raced, so the precondition is real, not fabricated). Then we
# race X's self-cancel (which — since this empties a booking-set slot to zero —
# should revert the slot to untyped and restore capacity to 3) against Y's
# book_slot('duo') on the SAME slot. Both valid orderings are asserted for:
#   (a) cancel commits first  → slot reverts untyped; Y's book_slot sees it
#       untyped, sets type='duo', books.
#   (b) Y's book commits first → slot is still typed='individual', capacity 1,
#       booked_count 1 → Y's guarded update matches zero rows → falls into the
#       diagnostic branch → training_type is not null and <> 'duo' → clean
#       type_mismatch; X's cancel then reverts the now-empty slot to untyped.
# What must NEVER happen: training_type='individual' with booked_count=0 (a
# stuck typed-but-empty slot — the revert silently failed to fire), or
# booked_count drifting from the live booking count.
#
# Capacity outcome differs by ordering since the open-slot-capacity fix
# (20260809000028): a REVERTED slot restores the admin's original 3 (from
# pre_booking_capacity, untouched here); a WON(duo) slot narrows fresh from
# the just-restored 3 to least(3, tpa.canonical_capacity('duo')) = 2 — it is
# NOT "untouched at 3" the way a pre-fix codebase would have left it.
echo "Scenario H — revert (self-cancel) racing a NEW differently-typed booking (K=20):"
H_K=20
HSETUP=""
for k in $(seq 1 $H_K); do
  HSETUP+="insert into public.coaches (id,name,bio,is_active) values ('cor_h$k','C','b',true);"
  HSETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_h$k','cor_h$k',now()+interval '1 day',now()+interval '1 day 1 hour',null,3,0,'published');"
  HSETUP+="insert into auth.users (id) values ('$(uuid $((800+k)))'),('$(uuid $((850+k)))');"
  HSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_hx$k','+2010h8${k}','HX','men','beginner',now(),'$(uuid $((800+k)))'),('plr_hy$k','+2010h5${k}','HY','men','beginner',now(),'$(uuid $((850+k)))');"
  HSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_hx$k','plr_hx$k','signup_grant',null,'individual',1,1,now()+interval '30 day',now()),('cbr_hy$k','plr_hy$k','signup_grant',null,'duo',1,1,now()+interval '30 day',now());"
done
sql "$HSETUP" >/dev/null
# Pre-step (un-raced): X books 'individual' on every slot — sets the real
# precondition (typed, capacity forced to 1, pre_booking_capacity=3 stashed).
for k in $(seq 1 $H_K); do call_as "$(uuid $((800+k)))" "select public.book_slot('slr_h$k','individual')" >/dev/null; done
H_PRE_OK=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type='individual' and booked_count=1 and capacity=1 and pre_booking_capacity=3")
check "precondition: all $H_K slots booking-set to individual/1/1 (pre_booking_capacity=3)" "$H_PRE_OK" "$H_K"

T=$(target 4)
for k in $(seq 1 $H_K); do
  BK=$(sql "select id from public.bookings where slot_id='slr_h$k' and player_id='plr_hx$k' and status='booked'")
  racer_cancel_own "$(uuid $((800+k)))" "$BK" "$T" "$TMP/h_cxl_$k.txt"
  racer_book_typed "$(uuid $((850+k)))" "slr_h$k" "duo" "$T" "$TMP/h_book_$k.txt"
done
wait
H_XLIVE=$(sql "select count(*) from public.bookings where slot_id like 'slr_h%' and player_id like 'plr_hx%' and status='booked'")
H_STUCK=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type='individual' and booked_count=0")
H_DRIFT=$(sql "select count(*) from public.session_slots s where id like 'slr_h%' and booked_count <> (select count(*) from public.bookings b where b.slot_id=s.id and b.status='booked')")
H_WON=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type='duo'")
H_REVERTED=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type is null")
H_REVERTED_CAP_BAD=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type is null and capacity <> 3")
H_WON_CAP_BAD=$(sql "select count(*) from public.session_slots where id like 'slr_h%' and training_type='duo' and capacity <> 2")
H_DEADLOCK=$(grep -rl "deadlock detected" "$TMP"/h_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "X's booking always ends cancelled (uncontested single-owner cancel)" "$H_XLIVE" "0"
check "no stuck typed-but-empty slot (revert always fires when it should)" "$H_STUCK" "0"
check "booked_count never drifts from live booking count"                  "$H_DRIFT" "0"
check "every trial resolved to won(duo) or reverted(untyped) — no 3rd state" "$((H_WON+H_REVERTED))" "$H_K"
check "reverted slots restore capacity to the admin's original 3"          "$H_REVERTED_CAP_BAD" "0"
check "won(duo) slots narrow capacity to duo's canonical 2 (least(3,2))"    "$H_WON_CAP_BAD" "0"
check "zero deadlocks"                                                     "$H_DEADLOCK" "0"
echo "  info — $H_WON/$H_K: Y won (duo set); $H_REVERTED/$H_K: Y lost, slot reverted untyped"

# ── Scenario I: DIFFERENT chosen types racing the SAME untyped slot (Task 0
# rule 3 — exactly one type wins; the other type gets a clean type_mismatch,
# no oversell within the winning type) ───────────────────────────────────────
#
# The admin's slot starts at capacity 4. Since the open-slot-capacity fix
# (20260809000028), the winning type's capacity narrows to
# least(4, tpa.canonical_capacity(winning_type)) — group's canonical (4)
# exactly matches this admin default, so a group win still seats all 4; duo's
# canonical (2) is SMALLER, so a duo win seats only 2 of its 4 racers — the
# other 2 correctly get 'slot_full' (a duo session really does fill at 2),
# NOT 'type_mismatch' (they ARE the winning type, just arrived after it
# filled). The expected winner count is therefore computed AFTER the race,
# once we know which type actually won — it is no longer a fixed 4.
echo "Scenario I — different types (group vs duo) racing one untyped, capacity-4 slot:"
ISETUP="insert into public.coaches (id,name,bio,is_active) values ('cor_i','C','b',true);"
ISETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_i','cor_i',now()+interval '1 day',now()+interval '1 day 1 hour',null,4,0,'published');"
for k in $(seq 1 4); do
  ISETUP+="insert into auth.users (id) values ('$(uuid $((700+k)))');"
  ISETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_ig$k','+2010i7${k}','IG','men','beginner',now(),'$(uuid $((700+k)))');"
  ISETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_ig$k','plr_ig$k','signup_grant',null,'group',1,1,now()+interval '30 day',now());"
  ISETUP+="insert into auth.users (id) values ('$(uuid $((720+k)))');"
  ISETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_id$k','+2010i2${k}','ID','men','beginner',now(),'$(uuid $((720+k)))');"
  ISETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_id$k','plr_id$k','signup_grant',null,'duo',1,1,now()+interval '30 day',now());"
done
sql "$ISETUP" >/dev/null

T=$(target 4)
for k in $(seq 1 4); do
  racer_book_typed "$(uuid $((700+k)))" slr_i group "$T" "$TMP/i_g_$k.txt"
  racer_book_typed "$(uuid $((720+k)))" slr_i duo   "$T" "$TMP/i_d_$k.txt"
done
wait
I_WINS=$(grep -lFx WIN "$TMP"/i_*.txt 2>/dev/null | wc -l | tr -d ' ')
I_MISMATCH=$(grep -lFx type_mismatch "$TMP"/i_*.txt 2>/dev/null | wc -l | tr -d ' ')
I_SLOTFULL=$(grep -lFx slot_full "$TMP"/i_*.txt 2>/dev/null | wc -l | tr -d ' ')
I_TYPE=$(sql "select training_type from public.session_slots where id='slr_i'")
I_COUNT=$(sql "select booked_count from public.session_slots where id='slr_i'")
I_CANON=$(sql "select tpa.canonical_capacity('$I_TYPE')")
I_EXPECTED=$(( I_CANON < 4 ? I_CANON : 4 ))
I_TYPES_BOOKED=$(sql "select count(distinct cb.training_type) from public.bookings b join public.credit_batches cb on cb.id=b.credit_batch_id where b.slot_id='slr_i' and b.status='booked'")
check "the winning type ($I_TYPE) seats exactly least(4, its canonical capacity), no oversell" "$I_WINS" "$I_EXPECTED"
check "the other type's 4 racers all get a clean type_mismatch"          "$I_MISMATCH" "4"
check "any excess same-type racers beyond canonical get slot_full, not type_mismatch" "$I_SLOTFULL" "$((4 - I_EXPECTED))"
check "booked_count matches the winning type's actual seated count"       "$I_COUNT" "$I_EXPECTED"
check "slot ends typed (either group or duo, never null)"                 "$([ -n "$I_TYPE" ] && echo yes || echo no)" "yes"
check "every winning booking spent a credit of the SAME (winning) type"   "$I_TYPES_BOOKED" "1"

# ── Scenario J: SAME chosen type racing an untyped slot (mirrors Scenario A —
# the existing same-type proof — but starting from training_type IS NULL, so
# this also proves the type gets set exactly once under contention) ──────────
echo "Scenario J — 8 racers, SAME type ('duo'), one untyped capacity-1 slot:"
JSETUP="insert into public.coaches (id,name,bio,is_active) values ('cor_j','C','b',true);"
JSETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_j','cor_j',now()+interval '1 day',now()+interval '1 day 1 hour',null,1,0,'published');"
for k in $(seq 1 8); do
  JSETUP+="insert into auth.users (id) values ('$(uuid $((730+k)))');"
  JSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_j$k','+2010j3${k}','J','men','beginner',now(),'$(uuid $((730+k)))');"
  JSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_j$k','plr_j$k','signup_grant',null,'duo',1,1,now()+interval '30 day',now());"
done
sql "$JSETUP" >/dev/null

T=$(target 4)
for k in $(seq 1 8); do racer_book_typed "$(uuid $((730+k)))" slr_j duo "$T" "$TMP/j_$k.txt"; done
wait
J_WINS=$(grep -lFx WIN "$TMP"/j_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "exactly one racer books (capacity 1)"    "$J_WINS" "1"
check "booked_count = 1 (no oversell)"          "$(sql "select booked_count from public.session_slots where id='slr_j'")" "1"
check "training_type set to 'duo' by the winner" "$(sql "select training_type from public.session_slots where id='slr_j'")" "duo"

# ── Scenario K: MIXED-GENDER racers, SAME type ('group'), racing one untyped
# capacity-4 slot — REPURPOSED for the gender-display-only migration
# (20260813000032). This scenario used to prove the gender TOCTOU fix (the
# guarded WHERE re-checking gender against the committed row, so only one
# gender could ever win the group and the other got a clean gender_mismatch —
# see git history for that version). Gender no longer gates booking at all —
# by design, this is the guarantee being REMOVED — so the scenario is now the
# positive mirror: ALL 8 racers across both genders should win, filling the
# capacity-4 slot as a genuinely mixed-gender group, with zero gender_mismatch
# ever returned. The capacity guard right next to the (now-deleted) gender
# clause must still hold exactly: 8 racers on a capacity-4 slot must still
# seat exactly 4, no oversell, regardless of gender mix.
echo "Scenario K — mixed-gender racers, SAME type (group), one untyped capacity-4 slot (gender no longer blocks):"
KSETUP="insert into public.coaches (id,name,bio,is_active) values ('cor_k','C','b',true);"
KSETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,status) values ('slr_k','cor_k',now()+interval '1 day',now()+interval '1 day 1 hour',null,4,0,'published');"
for k in $(seq 1 4); do
  KSETUP+="insert into auth.users (id) values ('$(uuid $((740+k)))');"
  KSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_kl$k','+2010k4${k}','KL','ladies','beginner',now(),'$(uuid $((740+k)))');"
  KSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_kl$k','plr_kl$k','signup_grant',null,'group',1,1,now()+interval '30 day',now());"
  KSETUP+="insert into auth.users (id) values ('$(uuid $((760+k)))');"
  KSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_km$k','+2010k6${k}','KM','men','beginner',now(),'$(uuid $((760+k)))');"
  KSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_km$k','plr_km$k','signup_grant',null,'group',1,1,now()+interval '30 day',now());"
done
sql "$KSETUP" >/dev/null

T=$(target 4)
for k in $(seq 1 4); do
  racer_book_typed "$(uuid $((740+k)))" slr_k group "$T" "$TMP/k_l_$k.txt"
  racer_book_typed "$(uuid $((760+k)))" slr_k group "$T" "$TMP/k_m_$k.txt"
done
wait
K_WINS=$(grep -lFx WIN "$TMP"/k_*.txt 2>/dev/null | wc -l | tr -d ' ')
K_GENDER_MISMATCH=$(grep -lFx gender_mismatch "$TMP"/k_*.txt 2>/dev/null | wc -l | tr -d ' ')
K_SLOTFULL=$(grep -lFx slot_full "$TMP"/k_*.txt 2>/dev/null | wc -l | tr -d ' ')
K_GENDER=$(sql "select gender from public.session_slots where id='slr_k'")
K_COUNT=$(sql "select booked_count from public.session_slots where id='slr_k'")
K_MIXED=$(sql "select count(distinct p.gender) from public.bookings b join public.players p on p.id=b.player_id where b.slot_id='slr_k' and b.status='booked'")
check "exactly 4 of the 8 racers win (capacity 4, no oversell — the guard beside the deleted gender clause)" "$K_WINS" "4"
check "zero racers ever get gender_mismatch — the reason no longer exists"       "$K_GENDER_MISMATCH" "0"
check "the other 4 racers lose cleanly on capacity (slot_full), not gender"      "$K_SLOTFULL" "4"
check "booked_count = 4"                                                         "$K_COUNT" "4"
check "slot still ends with a recorded gender (from whichever racer committed first — display-only, not dropped)" "$([ -n "$K_GENDER" ] && echo yes || echo no)" "yes"
# NOT asserted as a fixed count: which 4 of the 8 actually win is real OS/network
# scheduling, not something the code controls — a single run could legitimately
# seat 4-of-1-gender by chance. The deterministic proof that mixing is POSSIBLE
# (not guaranteed every run) is gender_display_only_test.sql's single-session
# case, where two specific, known genders are made to win in sequence. This
# line just reports what actually happened this run.
echo "  info — $K_MIXED distinct gender(s) among the 4 seated this run (both 1 and 2 are legitimate outcomes — capacity, not gender, decides who wins)"

# ── Scenario L: delete_account racing cancel_booking on the SAME booking, on a
# slot with a SECOND live booker (the delete_account residual fix). Before the
# fix, delete_account's cursor (FOR UPDATE OF s — only the slot is locked, not
# bookings) could deliver a booking row whose 'booked' status came from a
# STALE snapshot: EvalPlanQual re-fetches only the locked table, so a
# concurrent cancel_booking that already flipped this exact booking to
# 'cancelled' was invisible to the cursor's WHERE clause, and the old code
# called tpa.free_slot_seat unconditionally — freeing a seat (and, if it
# looked like the last one, reverting the slot) even though a SECOND player
# (Y) still holds a genuinely live booking on it. The fix makes the guarded
# booking-cancel UPDATE the arbiter (a fresh, live read, never the stale
# cursor snapshot) — only free the seat if THIS transaction's own cancel
# actually landed. Invariants: booked_count always equals live bookings; the
# slot NEVER reverts while Y's booking is still live; Y is completely
# untouched; X's credit ends refunded-once or not-at-all, never double.
echo "Scenario L — delete_account racing cancel_booking on the SAME booking, slot has a 2nd live booker (K=20):"
L_K=20
LSETUP=""
for k in $(seq 1 $L_K); do
  LSETUP+="insert into public.coaches (id,name,bio,is_active) values ('cor_l$k','C','b',true);"
  LSETUP+="insert into public.session_slots (id,coach_id,starts_at,ends_at,training_type,capacity,booked_count,gender,level,set_by_booking_at,status) values ('slr_l$k','cor_l$k',now()+interval '5 hour',now()+interval '6 hour','group',4,2,'men','beginner',now(),'published');"
  LSETUP+="insert into auth.users (id) values ('$(uuid $((900+k)))'),('$(uuid $((950+k)))');"
  LSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_lx$k','+2010l9${k}','LX','men','beginner',now(),'$(uuid $((900+k)))'),('plr_ly$k','+2010l5${k}','LY','men','beginner',now(),'$(uuid $((950+k)))');"
  LSETUP+="insert into public.credit_batches (id,player_id,source,purchase_id,training_type,quantity_total,quantity_remaining,expires_at,created_at) values ('cbr_lx$k','plr_lx$k','signup_grant',null,'group',1,0,now()+interval '30 day',now()),('cbr_ly$k','plr_ly$k','signup_grant',null,'group',1,0,now()+interval '30 day',now());"
  LSETUP+="insert into public.bookings (id,slot_id,player_id,credit_batch_id,status,booked_at) values ('bkr_lx$k','slr_l$k','plr_lx$k','cbr_lx$k','booked',now()),('bkr_ly$k','slr_l$k','plr_ly$k','cbr_ly$k','booked',now());"
done
sql "$LSETUP" >/dev/null

T=$(target 4)
for k in $(seq 1 $L_K); do
  racer_cancel_own       "$(uuid $((900+k)))" "bkr_lx$k" "$T" "$TMP/l_cxl_$k.txt"
  racer_delete_account   "$(uuid $((900+k)))"            "$T" "$TMP/l_del_$k.txt"
done
wait

L_DRIFT=$(sql "select count(*) from public.session_slots s where id like 'slr_l%' and booked_count <> (select count(*) from public.bookings b where b.slot_id=s.id and b.status='booked')")
L_REVERTED=$(sql "select count(*) from public.session_slots where id like 'slr_l%' and training_type is null")
L_Y_TOUCHED=$(sql "select count(*) from public.bookings where id like 'bkr_ly%' and status <> 'booked'")
L_X_LIVE=$(sql "select count(*) from public.bookings where id like 'bkr_lx%' and status = 'booked'")
L_CREDIT_BAD=$(sql "select count(*) from public.credit_batches where id like 'cbr_lx%' and quantity_remaining not in (0,1)")
L_DEADLOCK=$(grep -rl "deadlock detected" "$TMP"/l_*.txt 2>/dev/null | wc -l | tr -d ' ')
check "booked_count never drifts from live bookings (no spurious free)"       "$L_DRIFT"      "0"
check "slot NEVER reverts while Y's booking is still live"                    "$L_REVERTED"   "0"
check "Y's booking is completely untouched (still booked)"                    "$L_Y_TOUCHED"  "0"
check "X's booking always ends cancelled (exactly one racer's cancel lands)"  "$L_X_LIVE"     "0"
check "X's credit ends refunded-once(1) or not-at-all(0), never double"       "$L_CREDIT_BAD" "0"
check "zero deadlocks"                                                        "$L_DEADLOCK"   "0"

# ── Scenario M: delete_package racing request_credits on the SAME unused
# package (the crux of the delete_package review — pgTAP is single-session and
# cannot exercise the actual FOR UPDATE lock window, only the decision logic
# for each fixed ordering; this is the real proof of the ordering itself).
# request_credits' FK-referencing insert (into credit_requests) blocks on
# delete_package's FOR UPDATE lock via Postgres's own FOR KEY SHARE check, so
# only two outcomes are possible per package, and BOTH must be clean (never a
# raw Postgres error surfacing from either racer):
#   (a) the request's insert lock-acquisition wins  → it lands, commits; then
#       delete_package's DELETE hits the now-real FK reference, catches it,
#       and retires (deleted_at set) — the request stays valid, referencing a
#       real (retired) package.
#   (b) delete_package's FOR UPDATE wins            → nothing references the
#       package yet, so its DELETE actually succeeds and commits; the
#       blocked request then unblocks to find the row genuinely gone, and its
#       insert's own FK check fails — caught by the new foreign_key_violation
#       handler, returning a clean package_missing, never a crash.
# What must NEVER happen: a credit_request referencing a package that no
# longer exists (impossible at the DB level, checked anyway), a package left
# ACTIVE and untouched (delete_package silently doing nothing), or a raw
# "ERROR" in any racer's output (an uncaught exception reaching the caller).
echo "Scenario M — delete_package racing request_credits on the SAME unused package (K=20):"
M_K=20
MSETUP="insert into public.admins (id,auth_user_id,display_name,created_at) values ('adm_dadm','$(uuid 999)','Adm',now()) on conflict (auth_user_id) do nothing;"
for k in $(seq 1 $M_K); do
  MSETUP+="insert into public.packages (id,training_type,session_count,price,name,is_active) values ('pkr_m$k','group',4,160000,'M$k',true);"
  MSETUP+="insert into auth.users (id) values ('$(uuid $((1000+k)))');"
  MSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id) values ('plr_m$k','+2010m0${k}','M','men','beginner',now(),'$(uuid $((1000+k)))');"
done
sql "$MSETUP" >/dev/null

T=$(target 4)
for k in $(seq 1 $M_K); do
  racer_delete_package   "$(uuid 999)"          "pkr_m$k" "$T" "$TMP/m_del_$k.txt"
  racer_request_credits  "$(uuid $((1000+k)))"  "pkr_m$k" "$T" "$TMP/m_req_$k.txt"
done
wait

M_ERRORS=$(grep -rl "ERROR" "$TMP"/m_*.txt 2>/dev/null | wc -l | tr -d ' ')
M_INCONSISTENT=$(sql "
  select count(*) from (
    select gs.k,
      exists(select 1 from public.packages where id='pkr_m'||gs.k) as pkg_exists,
      coalesce((select deleted_at is not null from public.packages where id='pkr_m'||gs.k), false) as pkg_retired,
      exists(select 1 from public.credit_requests where package_id='pkr_m'||gs.k) as req_exists
    from generate_series(1,$M_K) as gs(k)
  ) t
  where not (
    (pkg_exists and pkg_retired and req_exists)      -- (a) request won the lock: retired, request intact
    or (not pkg_exists and not req_exists)            -- (b) delete won the lock: hard-deleted, nothing references it
  )
")
M_ORPHAN_REQ=$(sql "select count(*) from public.credit_requests cr where cr.package_id like 'pkr_m%' and not exists (select 1 from public.packages p where p.id = cr.package_id)")
check "zero raw errors from either racer (no uncaught exception under the race)" "$M_ERRORS"      "0"
check "every package ends in exactly one consistent state (retired+request, or hard-deleted+no request)" "$M_INCONSISTENT" "0"
check "zero orphaned credit_requests (none ever references a gone package)"      "$M_ORPHAN_REQ"  "0"
M_RETIRED=$(sql "select count(*) from public.packages where id like 'pkr_m%' and deleted_at is not null")
M_DELETED=$(sql "select $M_K - count(*) from public.packages where id like 'pkr_m%'")
echo "  info — $M_RETIRED/$M_K: request won the lock (retired); $M_DELETED/$M_K: delete won the lock (hard-deleted) — both orderings are legitimate, real OS scheduling decides which"

# ── teardown ─────────────────────────────────────────────────────────────────
cleanup_rows
echo
if [ "$FAILS" -eq 0 ]; then echo "CONCURRENCY PROOF: PASS (all invariants held under real parallelism)"; exit 0
else echo "CONCURRENCY PROOF: FAIL ($FAILS assertion(s) broke)"; exit 1; fi
