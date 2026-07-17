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

uuid() { printf '00000000-0000-0000-0000-%012d' "$1"; }  # deterministic test uuids

FAILS=0
check() { # $1=label $2=got $3=want
  if [ "$2" = "$3" ]; then echo "  ok   — $1 (=$2)"; else echo "  FAIL — $1 (got $2, want $3)"; FAILS=$((FAILS+1)); fi
}

cleanup_rows() {
  # book_slot mints bookings with 'bk_<uuid>' ids, so delete bookings by their
  # slot/player, not by an id prefix (FK-safe order: bookings → batches → slots → players → coaches).
  sql "delete from public.bookings       where slot_id like 'slr_%' or player_id like 'plr_%';
       delete from public.credit_batches where id like 'cbr_%' or player_id like 'plr_%';
       delete from public.session_slots  where id like 'slr_%';
       delete from public.players        where id like 'plr_%';
       delete from public.coaches        where id like 'cor_%';
       delete from auth.users            where id::text like '00000000-0000-0000-0000-%';" >/dev/null
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
DSETUP+="insert into public.players (id,phone,name,gender,level,created_at,auth_user_id,is_admin) values ('plr_dadm','+201000900','Adm','men','beginner',now(),'$(uuid 999)',true);"
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

# ── teardown ─────────────────────────────────────────────────────────────────
cleanup_rows
echo
if [ "$FAILS" -eq 0 ]; then echo "CONCURRENCY PROOF: PASS (all invariants held under real parallelism)"; exit 0
else echo "CONCURRENCY PROOF: FAIL ($FAILS assertion(s) broke)"; exit 1; fi
