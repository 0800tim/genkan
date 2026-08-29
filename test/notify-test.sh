#!/usr/bin/env bash
# hearth:summary=Prove the notifier: never twice, never lost, quiet by default, nothing private on a lock screen.
#
# Runs entirely against a throwaway database and a local HTTP listener this
# script starts and stops itself. It NEVER touches the household database and
# never sends anything to a real address or a real topic, which is the whole
# point: a test suite for notifications that could message somebody's actual
# phone is a test suite nobody will run.
#
#   sudo not required. Needs docker, a running postgres container, and python3.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="hearth_notify_test_$$"
PORT_OK="${NOTIFY_TEST_PORT:-18991}"
PORT_BAD=$((PORT_OK + 1))
TMP="$(mktemp -d -t hearth-notify-test.XXXXXX)"
for _t in docker python3; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
notify(){ HEARTH_DB="$DB" HEARTH_DB_ROLE=postgres PG_CONTAINER="$PG" bash "$R/bin/kidnet-notify" "$@" 2>&1; }
cleanup(){
  [ -n "${OKPID:-}" ] && kill "$OKPID" 2>/dev/null
  [ -n "${BADPID:-}" ] && kill "$BADPID" 2>/dev/null
  docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

# A stand-in for ntfy. One instance answers 200, one answers 500, so the happy
# path and a route that is down are both real HTTP rather than a mock.
cat > "$TMP/listener.py" <<'PY'
import sys, json
from http.server import BaseHTTPRequestHandler, HTTPServer
LOG, MODE = sys.argv[2], sys.argv[3]
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n).decode("utf-8", "replace")
        with open(LOG, "a") as f:
            f.write(json.dumps({"path": self.path, "title": self.headers.get("Title"),
                                "priority": self.headers.get("Priority"),
                                "auth": self.headers.get("Authorization"), "body": body}) + "\n")
        self.send_response(500 if MODE == "fail" else 200)
        self.send_header("content-length", "2"); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$TMP/listener.py" "$PORT_OK"  "$TMP/ok.log"  ok   >/dev/null 2>&1 & OKPID=$!
python3 "$TMP/listener.py" "$PORT_BAD" "$TMP/bad.log" fail >/dev/null 2>&1 & BADPID=$!
up=0
for _ in $(seq 1 40); do
  python3 - "$PORT_OK" <<'PY' && { up=1; break; }
import socket, sys
s = socket.socket(); s.settimeout(0.25)
sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
PY
done
[ "$up" = 1 ] || { echo "could not start the test listener on 127.0.0.1:$PORT_OK"; exit 1; }
OK_URL="http://127.0.0.1:$PORT_OK/a-test-topic"
BAD_URL="http://127.0.0.1:$PORT_BAD/a-test-topic"

echo
echo "A database with the notification schema in it"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
echo "$out" | grep -q FAILED && { bad "the schema loads"; echo "$out" | grep FAILED | sed 's/^/      /'; } \
  || ok "the schema loads"
psql "INSERT INTO children(name,age,policy_tier) VALUES ('TestKid',11,'young')" >/dev/null

echo
echo "A fresh install sends nothing to anybody"
notify run | grep -q "no routes configured" \
  && ok "with no routes, nothing is sent and the worker says so" \
  || bad "a fresh install did something with no routes configured"

echo
echo "Adding a route, and proving it before trusting it"
printf '%s\n' "$OK_URL" | notify add ntfy testroute --severity info >/dev/null
[ "$(psql "SELECT count(*) FROM notify_routes WHERE name='testroute'")" = 1 ] \
  && ok "a route can be added" || bad "the route was not added"
notify test testroute >/dev/null
grep -q '"title": "Hearth: this is a test"' "$TMP/ok.log" \
  && ok "'send a test' actually puts a message on the wire" \
  || bad "the test button sent nothing"
[ "$(psql "SELECT count(*) FROM notify_log WHERE is_test")" -ge 1 ] \
  && ok "a test is recorded as a test, so it cannot eat a real alert's rate allowance" \
  || bad "a test was not marked as one"

echo
echo "A burst is one notification, not twelve"
psql "INSERT INTO alerts(severity,category,detail)
      SELECT 'info','devices','a device joined ('||g||')' FROM generate_series(1,12) g" >/dev/null
: > "$TMP/ok.log"
psql "UPDATE notify_log SET ts = ts - interval '10 minutes'" >/dev/null
notify run >/dev/null
n=$(grep -c . "$TMP/ok.log" || true)
[ "${n:-0}" = 1 ] && ok "twelve unknown devices produced exactly one message" \
  || bad "twelve unknown devices produced ${n:-0} messages"
grep -q '12 devices nobody has claimed' "$TMP/ok.log" \
  && ok "and the one message says how many" \
  || bad "the collapsed message did not say how many devices"

echo
echo "Never the same thing twice"
: > "$TMP/ok.log"
psql "UPDATE notify_log SET ts = ts - interval '10 minutes'" >/dev/null
notify run >/dev/null; notify run >/dev/null
n=$(grep -c . "$TMP/ok.log" || true)
[ "${n:-0}" = 0 ] && ok "running again sent nothing: an alert goes to a route once, ever" \
  || bad "an alert was sent twice (${n:-0} extra messages)"
# The constraint is the mechanism, so prove the constraint and not just the code.
psql "INSERT INTO notify_sent(route_id,alert_id,status)
      SELECT route_id, alert_id, 'sent' FROM notify_sent LIMIT 1" | grep -q 'duplicate key' \
  && ok "the database itself refuses a second send of the same alert to the same route" \
  || bad "notify_sent accepted a duplicate, so two overlapping runs could double-send"

echo
echo "Quiet by default: a chore is not a 2am push"
psql "DELETE FROM notify_routes" >/dev/null
printf '%s\n' "$OK_URL" | notify add ntfy defaultroute >/dev/null
[ "$(psql "SELECT min_severity FROM notify_routes WHERE name='defaultroute'")" = warn ] \
  && ok "a new route defaults to 'warn', so routine housekeeping never buzzes" \
  || bad "a new route defaults to something noisier than 'warn'"
: > "$TMP/ok.log"
psql "INSERT INTO alerts(severity,category,detail) VALUES ('info','earn','a job is waiting')" >/dev/null
notify run >/dev/null
grep -q 'waiting for your yes' "$TMP/ok.log" \
  && bad "a routine info alert fired on a default route" \
  || ok "a job waiting for approval did not buzz a default route"

echo
echo "Quiet hours hold the ordinary and let the urgent through"
notify set defaultroute --quiet 00:00-23:59 >/dev/null
: > "$TMP/ok.log"
psql "INSERT INTO alerts(severity,category,detail) VALUES ('warn','proxy-vpn','looked up a vpn')" >/dev/null
notify run | grep -q 'until quiet hours end' \
  && ok "an ordinary alert is held during quiet hours" \
  || bad "an ordinary alert went out during quiet hours"
psql "INSERT INTO alerts(severity,category,detail) VALUES ('urgent','self-harm','care alert')" >/dev/null
notify run >/dev/null
grep -q 'worth a quiet check in' "$TMP/ok.log" \
  && ok "an urgent care alert still reaches a parent during quiet hours" \
  || bad "an urgent care alert was held by quiet hours, which is the one thing it must not be"
# And a household that turns that off gets what it asked for, plainly.
notify set defaultroute --quiet-urgent no >/dev/null
psql "INSERT INTO alerts(severity,category,detail) VALUES ('urgent','gateway','the gateway needs a look')" >/dev/null
notify run | grep -q 'until quiet hours end' \
  && ok "with --quiet-urgent no, even the urgent waits, as asked" \
  || bad "--quiet-urgent no did not hold an urgent alert"
notify set defaultroute --quiet off >/dev/null

echo
echo "Nothing private reaches a lock screen"
# The rule is in the data, so read it out of the data rather than trusting the
# script: the sensitive categories may name nobody and quote nothing.
for c in self-harm tor darknet drugs extreme proxy-vpn; do
  r=$(psql "SELECT count(*) FROM notify_wording WHERE category='$c' AND NOT name_ok AND NOT detail_ok")
  [ "$r" = 1 ] && ok "'$c' may name no child and quote no detail" \
    || bad "'$c' is allowed to put a name or a domain on a lock screen"
done
# Proven end to end as well, with a route that has asked for every detail it can
# have: the message about a child must still contain neither the child nor the
# site. This is the single most important assertion in the file.
psql "DELETE FROM notify_routes" >/dev/null
printf '%s\n' "$OK_URL" | notify add ntfy loudroute --severity info --detail >/dev/null
: > "$TMP/ok.log"
psql "INSERT INTO alerts(severity,category,domain,detail,child_id)
      VALUES ('urgent','self-harm','a-forum.example',
              'Reached a pro-suicide forum. CARE alert, never disciplinary.',
              (SELECT id FROM children WHERE name='TestKid'))" >/dev/null
notify run >/dev/null
msg=$(cat "$TMP/ok.log")
grep -q 'TestKid' <<<"$msg" && bad "the care alert named the child on a lock screen" \
  || ok "the care alert names no child, even on a route that asked for everything"
grep -q 'a-forum.example' <<<"$msg" && bad "the care alert put the site on a lock screen" \
  || ok "the care alert quotes no site"
grep -qiE 'suicide|self.harm' <<<"$msg" && bad "the care alert says what it is about in plain sight" \
  || ok "the care alert does not say what it is about where a stranger could read it"
grep -q 'Read it somewhere private' <<<"$msg" \
  && ok "and it tells the parent to read the detail privately" \
  || bad "the care alert does not tell the parent where or how to read the detail"
grep -q '"priority": "5"' <<<"$msg" \
  && ok "it goes out at the highest priority, so a phone on do-not-disturb still shows it" \
  || bad "the care alert did not go out at the highest priority"

echo
echo "A route that is down must never lose an alert, or break anything"
psql "DELETE FROM notify_routes" >/dev/null
printf '%s\n' "$BAD_URL" | notify add ntfy deadroute --severity info >/dev/null
psql "INSERT INTO alerts(severity,category,detail) VALUES ('warn','tor','asked for tor bridges')" >/dev/null
notify run >/dev/null 2>&1
rc=$?
[ "$rc" = 0 ] && ok "a failing route exits 0, so it can never fail a timer or block anything else" \
  || bad "the worker exited $rc when a route was down"
[ "$(psql "SELECT count(*) FROM notify_pending WHERE route='deadroute'")" -gt 0 ] \
  && ok "the alert is still pending, so it goes the moment the route comes back" \
  || bad "an alert was consumed by a route that never delivered it"
[ "$(psql "SELECT count(*) FROM notify_sent s JOIN notify_routes r ON r.id=s.route_id
            WHERE r.name='deadroute' AND s.status='sent'")" = 0 ] \
  && ok "nothing was recorded as sent that was not sent" \
  || bad "a failed send was recorded as delivered"
[ "$(psql "SELECT count(*) FROM notify_log WHERE NOT ok")" -gt 0 ] \
  && ok "the failure is loud in the log" || bad "a failure was swallowed silently"
# The log and the error field are read by people and pasted into bug reports.
n=$(psql "SELECT count(*) FROM notify_log WHERE detail LIKE '%://%' OR detail LIKE '%a-test-topic%'")
[ "${n:-1}" = 0 ] && ok "no address or token is ever written to the log" \
  || bad "the log contains a route's address"
n=$(psql "SELECT count(*) FROM notify_routes WHERE last_error LIKE '%://%' OR last_error LIKE '%a-test-topic%'")
[ "${n:-1}" = 0 ] && ok "no address or token is ever written to a route's last error" \
  || bad "a route's last_error contains its address"
notify run | grep -q 'waiting before the next try' \
  && ok "a dead route is left alone for a moment instead of being hammered every tick" \
  || bad "a dead route is retried immediately, which fills the log with one line"

echo
echo "Old alerts are retired, not fired at somebody's phone"
psql "DELETE FROM notify_routes" >/dev/null
psql "INSERT INTO alerts(ts,severity,category,detail)
      SELECT now() - interval '5 days','warn','tor','an old alert from a restore' FROM generate_series(1,3)" >/dev/null
printf '%s\n' "$OK_URL" | notify add ntfy freshroute --severity info >/dev/null
: > "$TMP/ok.log"
notify run | grep -q 'older than' \
  && ok "alerts older than the horizon are retired unsent" \
  || bad "a route added today would have fired a week of history at a phone"
grep -q 'conversation tonight' "$TMP/ok.log" \
  && bad "a five day old alert was sent as if it had just happened" \
  || ok "and none of them was actually sent"
[ "$(psql "SELECT count(*) FROM notify_sent WHERE status='stale'")" -gt 0 ] \
  && ok "the retired ones are marked 'stale', so they can never come back at 3am" \
  || bad "retired alerts were not recorded, so they would be reconsidered next run"

echo
echo "Only the routes that are built can be created"
notify add email mum-email --target "$OK_URL" 2>&1 | grep -q 'not built yet' \
  && ok "an email route is refused with a reason, not created and left silently broken" \
  || bad "an email route was accepted, and it would never have sent anything"
notify add homeassistant ha --target "$OK_URL" 2>&1 | grep -q 'not built yet' \
  && ok "a Home Assistant route is refused the same way" \
  || bad "a homeassistant route was accepted"

echo
echo "Operator input is checked before it reaches SQL or a URL"
notify add ntfy 'bad name' --target "$OK_URL" 2>&1 | grep -q 'letters, numbers' \
  && ok "a route name is checked to an alphabet" || bad "a bad route name was accepted"
notify add ntfy evil --target 'javascript:alert(1)' 2>&1 | grep -q 'http' \
  && ok "a target must be an http(s) URL" || bad "a non-http target was accepted"
notify add ntfy evil2 --target "http://x.example/\$(id)" 2>&1 | grep -q 'characters a URL cannot have' \
  && ok "a target with shell characters in it is refused" || bad "a target with shell characters was accepted"
notify set freshroute --quiet '9pm-7am' 2>&1 | grep -q '21:30-07:00' \
  && ok "quiet hours must be a time of day" || bad "nonsense quiet hours were accepted"

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
