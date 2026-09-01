#!/usr/bin/env bash
# genkan:summary=The CLI's database role must not be able to leave the database.
#
# bin/kidnet and the timers used to connect as the Postgres superuser, on an
# instance shared with unrelated projects. Any SQL injection in bin/ was
# therefore COPY ... TO PROGRAM away from running commands inside the database
# container, and could read and write every other database on the box. They
# connect as kids_agent now (config/db/grants.sql).
#
# This suite proves the fence is real, on a throwaway database, by trying to
# climb it. It does not touch the household database at all.
#
#   sudo not required. Needs docker and a running postgres container.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_role_test_$$"
ROLE="${GENKAN_DB_ROLE:-kids_agent}"
for _t in docker; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
su_sql(){    docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
agent_sql(){ docker exec -i "$PG" psql -U "$ROLE" -d "$DB" -tAc "$1" 2>&1; }
# A statement that MUST be refused. Passes only on a real refusal, never on a
# statement that quietly did nothing.
refused(){ local what="$1" sql="$2" out
  out=$(agent_sql "$sql")
  case "$out" in
    *"permission denied"*|*"must be owner"*|*"ERROR:  permission"*) ok "$what";;
    *) bad "$what (it was NOT refused: ${out:0:90})";;
  esac; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; }
trap cleanup EXIT

echo
echo "The CLI's database role, and what it cannot do"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
echo "$out" | grep -q FAILED && { echo "$out" | grep FAILED | sed 's/^/      /'; }

# ---- the role's own attributes ---------------------------------------------
read -r su cr cd brls rep <<<"$(docker exec -i "$PG" psql -U postgres -tAc \
  "SELECT rolsuper||' '||rolcreaterole||' '||rolcreatedb||' '||rolbypassrls||' '||rolreplication
     FROM pg_roles WHERE rolname='$ROLE'" 2>/dev/null)"
# Concatenated to text a Postgres boolean prints "false", not "f".
[ "${su:-}" = false ]   && ok "$ROLE is not a superuser"         || bad "$ROLE IS a superuser"
[ "${cr:-}" = false ]   && ok "$ROLE cannot create roles"        || bad "$ROLE can create roles"
[ "${cd:-}" = false ]   && ok "$ROLE cannot create databases"    || bad "$ROLE can create databases"
[ "${brls:-}" = false ] && ok "$ROLE cannot bypass row security" || bad "$ROLE bypasses row security"
[ "${rep:-}" = false ]  && ok "$ROLE cannot replicate"           || bad "$ROLE can replicate"
n=$(docker exec -i "$PG" psql -U postgres -tAc \
  "SELECT count(*) FROM pg_auth_members WHERE member='$ROLE'::regrole::oid" 2>/dev/null)
[ "${n:-1}" = 0 ] && ok "$ROLE is a member of no other role" \
  || bad "$ROLE is a member of ${n:-?} other role(s); check none of them is pg_execute_server_program"

# ---- the escape routes ------------------------------------------------------
# This is the finding. A superuser connection turns any injection in bin/ into
# command execution inside the postgres container; this must be refused.
refused "COPY ... TO PROGRAM is refused (no command execution)" \
        "COPY (SELECT 1) TO PROGRAM 'touch /tmp/genkan-role-test-rce'"
if docker exec -i "$PG" test -e /tmp/genkan-role-test-rce 2>/dev/null; then
  bad "COPY TO PROGRAM actually ran a command"
  docker exec -i "$PG" rm -f /tmp/genkan-role-test-rce
else ok "no command ran: the file COPY TO PROGRAM would have made is absent"; fi
# The exact shape the 2026-08-30 review proved end to end through `kidnet
# topsites`: a second statement appended to the first.
refused "the same thing appended as a second statement is refused too" \
        "SELECT 1; COPY (SELECT 1) TO PROGRAM 'touch /tmp/genkan-role-test-rce2'; "
docker exec -i "$PG" test -e /tmp/genkan-role-test-rce2 2>/dev/null \
  && { bad "the appended statement ran"; docker exec -i "$PG" rm -f /tmp/genkan-role-test-rce2; } \
  || ok "the appended statement ran nothing either"
refused "COPY FROM a server file is refused (no reading /etc)" \
        "CREATE TEMP TABLE _rt(l text); COPY _rt FROM '/etc/passwd'"
refused "pg_read_file() is refused"       "SELECT pg_read_file('/etc/passwd',0,16)"
refused "pg_ls_dir() is refused"          "SELECT pg_ls_dir('/')"

# ---- no DDL: an injection cannot destroy the household's history ------------
refused "DROP TABLE is refused"      "DROP TABLE children"
refused "TRUNCATE is refused"        "TRUNCATE dns_log"
refused "ALTER TABLE is refused"     "ALTER TABLE children ADD COLUMN x int"
refused "DELETE FROM children is refused"   "DELETE FROM children WHERE false"
refused "DELETE FROM dns_log is refused"    "DELETE FROM dns_log WHERE false"
refused "DELETE FROM time_events is refused" "DELETE FROM time_events WHERE false"

# ---- no escalation ----------------------------------------------------------
refused "it cannot make itself a superuser"  "ALTER ROLE $ROLE SUPERUSER"
refused "it cannot create a role"            "CREATE ROLE genkan_role_test_evil LOGIN"
refused "it cannot grant itself pg_execute_server_program" \
        "GRANT pg_execute_server_program TO $ROLE"

# ---- no password, so no route in from off the box ---------------------------
p=$(docker exec -i "$PG" psql -U postgres -tAc \
      "SELECT coalesce(rolpassword,'') FROM pg_authid WHERE rolname='$ROLE'" 2>/dev/null)
[ -z "${p:-}" ] && ok "$ROLE has no password, so pg_hba's scram rule can never let it in over TCP" \
  || bad "$ROLE has a password set; it is reachable from off the local socket"

# ---- the household database is not open to every role on the server ---------
acl=$(docker exec -i "$PG" psql -U postgres -tAc \
        "SELECT coalesce(datacl::text,'') FROM pg_database WHERE datname='$DB'" 2>/dev/null)
case "$acl" in
  *"=Tc/"*|"") bad "PUBLIC can still CONNECT to the Genkan database";;
  *)           ok "PUBLIC cannot CONNECT to the Genkan database (only kids_app and $ROLE)";;
esac

# ---- and it can still do its actual job -------------------------------------
# A fence that also stops the CLI working is not a fix, it is an outage. These
# are the relations bin/kidnet and the timers open on an ordinary evening.
for rel in children devices device_roster household_roster time_remaining \
           time_ledger category_state category_budgets category_usage \
           dhcp_leases dns_log alerts always_allow flag_domains policies \
           services service_ips service_usage category_ips category_domains \
           unclaimed_devices claim_settings device_policy_effective; do
  out=$(agent_sql "SELECT count(*) FROM $rel")
  case "$out" in ''|*[!0-9]*) bad "$ROLE cannot read $rel: ${out:0:70}";; *) ok "$ROLE can read $rel";; esac
done
for stmt in \
  "INSERT INTO block_events(target_type,target_ref,action,source,actor) VALUES('t','t','t','t','t')" \
  "INSERT INTO alerts(severity,category,detail) VALUES('info','roletest','t')" \
  "UPDATE alerts SET acknowledged=true WHERE category='roletest'" \
  "INSERT INTO category_ips(ip,category,seen) VALUES('203.0.113.250','gaming',now()) ON CONFLICT DO NOTHING" \
  "DELETE FROM category_ips WHERE host(ip)='203.0.113.250'" ; do
  out=$(agent_sql "$stmt")
  case "$out" in *"permission denied"*) bad "$ROLE cannot: ${stmt:0:52}...";; *) ok "$ROLE can: ${stmt:0:52}...";; esac
done
# The scope functions are how bin/kidnet resolves 'kids' to people and to
# addresses, and the never-cut-the-front-door-lock guard lives inside them.
out=$(agent_sql "SELECT count(*) FROM people_in_scope('kids')")
case "$out" in ''|*[!0-9]*) bad "$ROLE cannot call people_in_scope(): ${out:0:60}";; *) ok "$ROLE can call people_in_scope()";; esac
out=$(agent_sql "SELECT count(*) FROM ips_in_scope('kids')")
case "$out" in ''|*[!0-9]*) bad "$ROLE cannot call ips_in_scope(): ${out:0:60}";; *) ok "$ROLE can call ips_in_scope()";; esac
# CREATE TEMP TABLE plus COPY FROM STDIN is how five of the timers load their
# batch. Losing it would silently stop DNS logging and device discovery.
out=$(printf '203.0.113.251\tgaming\n' | docker exec -i "$PG" psql -U "$ROLE" -d "$DB" -qc \
  "CREATE TEMP TABLE _ci(ip inet, category text); COPY _ci FROM STDIN WITH (FORMAT text);
   INSERT INTO category_ips(ip,category,seen) SELECT ip,category,now() FROM _ci
   ON CONFLICT (ip,category) DO UPDATE SET seen=now();" 2>&1)
case "$out" in *ERROR*) bad "$ROLE cannot do the temp-table COPY the timers use: ${out:0:70}";;
               *)       ok "$ROLE can do the temp-table COPY FROM STDIN the timers use";; esac

# ---- the safety net cannot be narrowed, even by a role that may DELETE ------
# grants.sql hands kids_agent DELETE on always_allow so a parent can take a
# reading-list row back out (genkan allow remove). The trigger in
# schema-settings.sql is what keeps that grant from ever reaching a help line,
# so it is proved here on the row that matters most, and then proved for the
# superuser too, because a trigger that only stops one role is a policy that
# only stops one role.
kept(){ local what="$1" sql="$2" who="$3" out
  if [ "$who" = su ]; then out=$(su_sql "$sql"); else out=$(agent_sql "$sql"); fi
  case "$out" in *"safety net"*) ok "$what";; *) bad "$what (it was NOT refused: ${out:0:90})";; esac; }
kept "$ROLE cannot delete a safety row (1737.org.nz)" \
     "DELETE FROM always_allow WHERE domain='1737.org.nz'" agent
kept "$ROLE cannot delete every safety row in one statement" \
     "DELETE FROM always_allow WHERE scope='safety'" agent
kept "even the superuser cannot delete a safety row" \
     "DELETE FROM always_allow WHERE domain='youthline.co.nz'" su
kept "even the superuser cannot narrow a safety row to the reading list" \
     "UPDATE always_allow SET scope='learn' WHERE domain='youthline.co.nz'" su
n=$(su_sql "SELECT count(*) FROM always_allow WHERE scope='safety' AND domain IN ('1737.org.nz','youthline.co.nz')")
[ "${n:-0}" = 2 ] && ok "both help lines are still in the safety net afterwards" \
  || bad "a help line is missing from the safety net (${n:-?} of 2)"
# And the grant is real for the thing it is for: a row a parent added can be
# added and taken away again.
out=$(agent_sql "WITH i AS (INSERT INTO always_allow(domain,scope,category,note,added_by,added_ts)
                 VALUES('roletest.example','learn','reading','t','parent',now()) RETURNING 1) SELECT count(*) FROM i")
[ "${out:-0}" = 1 ] && ok "$ROLE can add a reading-list row" || bad "$ROLE cannot add a reading-list row: ${out:0:70}"
out=$(agent_sql "WITH d AS (DELETE FROM always_allow WHERE domain='roletest.example' AND added_by='parent' RETURNING 1) SELECT count(*) FROM d")
[ "${out:-0}" = 1 ] && ok "$ROLE can remove the row it added" || bad "$ROLE cannot remove the row it added: ${out:0:70}"
out=$(agent_sql "WITH u AS (UPDATE policies SET adguard_parental=adguard_parental WHERE tier='standard' RETURNING 1) SELECT count(*) FROM u")
[ "${out:-0}" = 1 ] && ok "$ROLE can edit a filter level (genkan tier set)" || bad "$ROLE cannot edit a filter level: ${out:0:70}"
refused "$ROLE cannot invent a filter level"  "INSERT INTO policies(tier) VALUES('roletest')"
refused "$ROLE cannot drop a filter level"    "DELETE FROM policies WHERE tier='young'"
refused "$ROLE cannot edit an allow-list row into a different promise" \
        "UPDATE always_allow SET scope='safety' WHERE domain='wikipedia.org'"


# ---- the gates in bin/kidnet ------------------------------------------------
# The role fence is the second line. The first is that no argument reaches a
# SQL string unchecked. Every verb below is fired with the exact payload the
# 2026-08-30 review used, and must refuse it before it opens a connection.
echo
echo "Every kidnet argument is gated before it reaches SQL"
PAYLOAD="1; COPY (SELECT 1) TO PROGRAM 'touch /tmp/genkan-gate-test'; --"
gated(){ local what="$1"; shift; local out rc
  out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" GW_CONTAINER=genkan-no-such-container \
        ADGUARD_PASS="" bash "$R/bin/kidnet" "$@" 2>&1); rc=$?
  case "$out" in
    *"bad name"*|*"bad number"*|*"bad text"*|*"bad id"*|*"bad domain"*|*"bad filter level"*|*"bad services"*|*"is not a MAC"*|*"is not an IPv4"*|*usage:*)
      [ "$rc" != 0 ] && ok "$what" || bad "$what (refused but exited 0)";;
    *) bad "$what (NOT refused: ${out:0:80})";;
  esac; }
gated "topsites refuses an injected LIMIT"        topsites "$PAYLOAD"
gated "recent refuses an injected LIMIT"          recent Zed "$PAYLOAD"
gated "assign refuses an injected address"        assign "$PAYLOAD" Zed laptop
gated "assign refuses an injected reservation"    assign aa:bb:cc:dd:ee:ff Zed laptop "$PAYLOAD"
gated "assign refuses an injected label"          assign aa:bb:cc:dd:ee:ff Zed "$PAYLOAD"
gated "infra refuses an injected address"         infra "$PAYLOAD"
gated "person add refuses an injected name"       person add "$PAYLOAD" child
gated "person add refuses an injected tier"       person add Zed child "$PAYLOAD"
gated "bonus refuses injected minutes"            bonus Zed "$PAYLOAD"
gated "bonus refuses an injected reason"          bonus Zed 5 "$PAYLOAD"
gated "penalty refuses injected minutes"          penalty Zed "$PAYLOAD"
gated "spend refuses injected minutes"            spend Zed "$PAYLOAD"
gated "grant refuses an injected category"        grant Zed "$PAYLOAD" 5
gated "grant refuses injected minutes"            grant Zed gaming "$PAYLOAD"
gated "earn refuses an injected task"             earn Zed "$PAYLOAD"
gated "off refuses an injected scope"             off "$PAYLOAD"
gated "game off refuses an injected name"         game off "$PAYLOAD"
gated "time refuses an injected name"             time "$PAYLOAD"
gated "confirm refuses an injected device"        confirm "$PAYLOAD"
gated "claim-mode refuses an injected mode"       claim-mode "$PAYLOAD"
gated "allow add refuses an injected domain"      allow add "$PAYLOAD" learn
gated "allow add refuses an injected note"        allow add example.org learn "$PAYLOAD"
gated "allow remove refuses an injected domain"   allow remove "$PAYLOAD"
gated "tier set refuses an injected level"        tier set "$PAYLOAD" parental true
gated "tier set refuses an injected value"        tier set young services "$PAYLOAD"
gated "guest leave refuses an injected name"      guest leave "$PAYLOAD"
if docker exec -i "$PG" test -e /tmp/genkan-gate-test 2>/dev/null; then
  bad "one of the payloads reached the server and ran"
  docker exec -i "$PG" rm -f /tmp/genkan-gate-test
else ok "no payload reached the server"; fi

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
