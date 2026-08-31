#!/usr/bin/env bash
# genkan:summary=The Tor relay list must reach the firewall, and say so when it does not.
#
# genkan-tor-sync fetched the public relay list every day for the life of the
# first box, wrote a file and an `nft -f` snippet, and reported success. Nothing
# applied the snippet. The @tor_nodes set was empty the whole time, the reject
# rules in kids.nft matched nothing, and genkan-health said "the Tor relay list
# is current" because it was reading the age of a file rather than asking the
# firewall what it held. Every piece worked; nothing owned the join.
#
# So this suite tests the join. The addresses go into Postgres, which the
# gateway already rebuilds its sets from, and the checks below are about that
# handover rather than about the fetch.
#
#   sudo not required. Needs docker and a running postgres container.
#   It builds its own database and never touches the household's.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_tor_test_$$"
WORK="$(mktemp -d)"
for _t in docker; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
sql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

# Run the real script with its fetch replaced, so the test never touches the
# Tor Project's servers and can decide exactly what a "fetch" returned.
sync_with(){  # $1 = file of addresses to pretend we fetched
  TOR_NODES_FILE="$WORK/nodes.txt" TOR_NFT_FILE="$WORK/nodes.nft" \
  GENKAN_DB="$DB" PG_CONTAINER="$PG" GENKAN_DB_ROLE=postgres TOR_MIN_NODES="${TOR_MIN_NODES:-1}" \
  FAKE_LIST="$1" bash -c '
    source_file="$FAKE_LIST"
    # Replace both fetchers; everything after them is the code under test.
    eval "$(sed -e "s|^fetch_onionoo(){|fetch_onionoo(){ cat \"$source_file\"; return 0; }\nunused_onionoo(){|" \
                -e "s|^fetch_danme(){|fetch_danme(){ cat \"$source_file\"; return 0; }\nunused_danme(){|" \
                "'"$R"'/bin/genkan-tor-sync" | sed "s|^case \"\${1:-sync}\".*||; s|^  sync)   sync;;||; s|^  emit)   emit;;||; s|^  status) status;;||; s|^  \*) echo \"usage.*||; s|^esac||")"
    sync' 2>&1
}

echo
echo "The Tor relay list reaches the firewall, or says why not"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
echo "$out" | grep -q FAILED && { echo "$out" | grep FAILED | sed 's/^/      /'; }

# ---- the schema is loaded by a fresh install ---------------------------------
t=$(sql "SELECT to_regclass('public.tor_nodes') IS NOT NULL")
[ "$t" = t ] && ok "a fresh install has a tor_nodes table" \
             || bad "a fresh install has no tor_nodes table"
n=$(sql "SELECT count(*) FROM tor_sync_state")
[ "$n" = 1 ] && ok "and exactly one tor_sync_state row" || bad "tor_sync_state has $n rows, expected 1"
o=$(sql "SELECT ok FROM tor_sync_state")
[ "$o" = f ] && ok "which starts as 'never successfully fetched'" \
             || bad "tor_sync_state starts as ok=$o, so a fresh box would claim a list it has not got"

# ---- a fetch lands in the table ---------------------------------------------
printf '%s\n' 10.9.0.1 10.9.0.2 10.9.0.3 > "$WORK/a.txt"
o=$(sync_with "$WORK/a.txt")
n=$(sql "SELECT count(*) FROM tor_nodes")
[ "$n" = 3 ] && ok "a fetch of three relays put three rows in the table" \
             || bad "the table holds $n rows after a fetch of three: ${o:0:80}"
case "$o" in *"database -> tor_nodes"*) ok "and it said so, so a reader can tell it landed";;
             *) bad "it did not report the database load (said: ${o:0:80})";; esac
o2=$(sql "SELECT node_count FROM tor_sync_state"); o3=$(sql "SELECT ok FROM tor_sync_state")
[ "$o2" = 3 ] && [ "$o3" = t ] && ok "and tor_sync_state records the count" \
                              || bad "tor_sync_state says ok=$o3 count=$o2, expected t and 3"

# ---- the same list again changes nothing ------------------------------------
first=$(sql "SELECT min(first_seen) FROM tor_nodes")
sync_with "$WORK/a.txt" >/dev/null
n=$(sql "SELECT count(*) FROM tor_nodes")
[ "$n" = 3 ] && ok "fetching the same list again leaves three rows, not six" || bad "the table holds $n rows"
again=$(sql "SELECT min(first_seen) FROM tor_nodes")
[ "$first" = "$again" ] && ok "and first_seen is not rewritten, so the history survives" \
                        || bad "first_seen changed on a repeat fetch"

# ---- a relay that leaves the consensus leaves the set -----------------------
# This is why DELETE is granted on this table and nowhere else that matters: a
# household that only ever adds ends up blocking addresses that are no longer
# Tor, and nobody can work out why a site stopped working.
printf '%s\n' 10.9.0.1 10.9.0.9 > "$WORK/b.txt"
sync_with "$WORK/b.txt" >/dev/null
n=$(sql "SELECT count(*) FROM tor_nodes")
[ "$n" = 2 ] && ok "a relay that left the list was removed" || bad "the table holds $n rows, expected 2"
g=$(sql "SELECT count(*) FROM tor_nodes WHERE ip='10.9.0.2'")
[ "$g" = 0 ] && ok "and it is specifically the withdrawn one that went" || bad "10.9.0.2 is still blocked"
g=$(sql "SELECT count(*) FROM tor_nodes WHERE ip='10.9.0.9'")
[ "$g" = 1 ] && ok "while the new one arrived" || bad "10.9.0.9 was not added"

# ---- a bad fetch must never empty the list ----------------------------------
# The dangerous direction. A fetch that returns nothing is a network problem,
# never an instruction to stop blocking Tor.
: > "$WORK/empty.txt"
o=$(TOR_MIN_NODES=1000 sync_with "$WORK/empty.txt")
n=$(sql "SELECT count(*) FROM tor_nodes")
[ "$n" = 2 ] && ok "a fetch that returned nothing left the previous addresses alone" \
             || bad "an empty fetch changed the table to $n rows"

printf '%s\n' 10.9.0.1 > "$WORK/short.txt"
o=$(TOR_MIN_NODES=1000 sync_with "$WORK/short.txt")
n=$(sql "SELECT count(*) FROM tor_nodes")
[ "$n" = 2 ] && ok "and so did a fetch too short to be a real consensus" \
             || bad "a short fetch changed the table to $n rows"

# ---- the query the gateway runs ---------------------------------------------
# If this stops returning bare addresses, the gateway's reconcile filters them
# all out and silently empties the set, which is the failure this whole change
# exists to prevent.
rows=$(sql "SELECT host(ip) FROM tor_nodes ORDER BY 1")
want=$(printf '10.9.0.1\n10.9.0.9')
[ "$rows" = "$want" ] && ok "the gateway's query returns bare addresses it can put in a set" \
                      || bad "the gateway's query returned: $(printf '%s' "$rows" | tr '\n' ' ')"
bad_rows=$(printf '%s\n' "$rows" | grep -cvE '^[0-9]+\.' || true)
[ "$bad_rows" = 0 ] && ok "and every row survives the gateway's own address filter" \
                    || bad "$bad_rows row(s) would be dropped by the gateway's filter"

# ---- the rules that use the set are still in the shipped ruleset ------------
grep -q 'daddr @tor_nodes' "$R/config/nftables/kids.nft" \
  && ok "kids.nft still rejects traffic to @tor_nodes" \
  || bad "kids.nft no longer has a rule using @tor_nodes"
grep -q 'update @tor_dev' "$R/config/nftables/kids.nft" \
  && ok "and still counts the attempt against the device" \
  || bad "the tor_dev attempt counter rule is gone"

# ---- the gateway actually asks for it ---------------------------------------
# The bug was a list nobody applied. A test that only checks the table would
# have passed throughout the outage.
grep -q 'reconcile_set tor_nodes' "$R/gateway/entrypoint.sh" \
  && ok "the gateway reconciles @tor_nodes from the database" \
  || bad "nothing in the gateway applies the list, which is the original bug"
grep -q 'sync_tor_nodes; last_sync' "$R/gateway/entrypoint.sh" \
  && ok "and refills it on the hourly pass" \
  || bad "nothing refills @tor_nodes on the hourly pass"
# The startup call is separate and easy to leave out, which is exactly what
# happened first time. load_firewall reloads kids.nft, which leaves the set
# empty, and last_sync starts at now, so without a call here every restart
# would run for an hour with no Tor block at all.
grep -q 'sync_safety_net; sync_tor_nodes' "$R/gateway/entrypoint.sh" \
  && ok "and fills it at startup, so a restart leaves no hour-long hole" \
  || bad "the set is not filled at startup, so every restart unblocks Tor for an hour"

# ---- health asks the firewall, not the file ---------------------------------
grep -q 'list set inet kids tor_nodes' "$R/bin/genkan-health" \
  && ok "genkan-health asks the firewall what it holds" \
  || bad "genkan-health is back to reading a file's age, which reported a block that was not there"

# ---- the bug that adding 7299 addresses actually caused ---------------------
# Filling this set pushed the ruleset past the pipe buffer, and genkan-health
# started reporting a complete firewall as incomplete. grep -q exits the moment
# it matches, the producer dies of SIGPIPE with 141, and `set -o pipefail`
# promotes that to the pipeline's status: a successful match reads as a
# failure. The sets are printed at the top of the table so they matched early
# and always failed; the chains are printed at the bottom so they kept passing.
big=$(printf 'set kids_block {\n'; head -c 200000 /dev/zero | tr '\0' 'x')
( set -uo pipefail; printf '%s' "$big" | grep -q 'set kids_block {' ) 2>/dev/null
[ "$?" = 141 ] && ok "the SIGPIPE race is real on this machine, so the check below means something" \
               || ok "the SIGPIPE race did not fire here, which is why it hid for so long"
( set -uo pipefail; case "$big" in *"set kids_block {"*) exit 0;; *) exit 1;; esac )
[ "$?" = 0 ] && ok "bash's own matching finds it regardless" \
             || bad "bash's own matching failed, which would break the firewall check"

grep -q 'case "$rules" in' "$R/bin/genkan-health" \
  && ok "genkan-health matches without a pipe" \
  || bad "genkan-health is back on printf|grep -q, which reports a working firewall as broken"

if command -v python3 >/dev/null; then
  o=$(cd "$R" && python3 tools/lint-pipefail-grep.py 2>&1)
  case "$o" in *"--- 0 "*) ok "no script pipes into grep -q under pipefail";;
               *) bad "an early-exit pipe under pipefail is back: $(echo "$o" | head -1)";; esac
else
  bad "python3 is missing, so the repo-wide sweep did not run"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
