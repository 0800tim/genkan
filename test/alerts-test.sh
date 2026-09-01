#!/usr/bin/env bash
# genkan:summary=A flagged domain must raise exactly one alert, and a broken query must be loud.
#
# genkan-alerts is the path that turns "a child looked up a self-harm site"
# into something a parent sees. It failed silently for a day: a bash comment
# had been written inside a double-quoted SQL string, where '#' is not a
# comment, so every run sent the comment to Postgres, printed a syntax error
# nobody was reading, counted zero rows, said "nothing new" and exited 0.
# systemd recorded success every minute while nothing was being checked.
#
# So this suite proves two things, and the second matters as much as the first:
# that a flagged domain does raise an alert, and that a query which cannot run
# is never mistaken for a quiet night.
#
#   sudo not required. Needs docker and a running postgres container.
#   It builds its own database and never touches the household's.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_alerts_test_$$"
for _t in docker; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
sql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
run_alerts(){ GENKAN_DB="$DB" PG_CONTAINER="$PG" GENKAN_DB_ROLE=postgres \
              bash "$R/bin/genkan-alerts" 2>&1; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; }
trap cleanup EXIT

echo
echo "Flagged domains raise alerts, and a broken alert path says so"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
echo "$out" | grep -q FAILED && { echo "$out" | grep FAILED | sed 's/^/      /'; }

# A child, a device, and a flagged domain to look up.
kid=$(sql "INSERT INTO children(name,policy_tier,kind) VALUES('Zed','standard','child') RETURNING id" | head -1)
dev=$(sql "INSERT INTO devices(child_id,mac,label) VALUES($kid,'aa:bb:cc:dd:ee:01','laptop') RETURNING id" | head -1)
pat=$(sql "SELECT pattern FROM flag_domains ORDER BY length(pattern) DESC LIMIT 1" | head -1)
[ -n "$pat" ] || { echo "no flag_domains seeded, cannot test"; exit 1; }
sql "INSERT INTO dns_log(device_id,domain,ts) VALUES($dev,'$pat',now())" >/dev/null

# ---- it raises one alert, and only one --------------------------------------
o=$(run_alerts)
case "$o" in *ERROR*) bad "a clean run prints no SQL error (got: ${o:0:70})";;
             *)       ok "a clean run prints no SQL error";; esac
n=$(sql "SELECT count(*) FROM alerts WHERE child_id=$kid" | head -1)
[ "$n" = 1 ] && ok "a flagged domain raised exactly one alert" \
             || bad "a flagged domain raised $n alerts, expected 1"
case "$o" in *"raised 1 new alert"*) ok "it reported the count correctly, not double";;
             *) bad "it did not report one new alert (said: ${o:0:70})";; esac

# The count came from an anchored grep because "INSERT 0 1" also contains a 1.
# One alert must never be reported as two.
case "$o" in *"raised 2 new"*) bad "the command tag was counted as a row again";;
             *) ok "the psql command tag was not counted as a row";; esac

# ---- the same domain again, same day, must not alert twice ------------------
sql "INSERT INTO dns_log(device_id,domain,ts) VALUES($dev,'$pat',now())" >/dev/null
o=$(run_alerts)
n=$(sql "SELECT count(*) FROM alerts WHERE child_id=$kid" | head -1)
[ "$n" = 1 ] && ok "the same flag on the same day did not alert twice" \
             || bad "a second look-up raised another alert ($n total)"
case "$o" in *"nothing new"*) ok "and it said nothing new";;
             *) bad "it did not say nothing new (said: ${o:0:70})";; esac

# ---- a query that cannot run is never a quiet night -------------------------
# This is the regression that matters. Break the SQL and check the script
# refuses to report calm: it must say so and exit non-zero, so systemd fails.
broken="$(mktemp)"; trap 'rm -f "$broken"; cleanup' EXIT
sed 's/RETURNING 1" 2>&1)/RETURNING 1 NOT VALID SQL" 2>\&1)/' "$R/bin/genkan-alerts" > "$broken"
o=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" GENKAN_DB_ROLE=postgres bash "$broken" 2>&1); rc=$?
[ "$rc" != 0 ] && ok "a broken alert query exits non-zero" \
               || bad "a broken alert query exited 0, so systemd would call it a success"
case "$o" in *"no flagged domain has been noticed"*) ok "and it says no domain was checked";;
             *) bad "it did not say the check had not happened (said: ${o:0:70})";; esac
case "$o" in *"nothing new"*) bad "a broken query still claimed there was nothing new";;
             *) ok "a broken query never claims there was nothing new";; esac

# ---- the failure is visible where a parent looks ----------------------------
# The unit runs this as ExecStartPost=- , so systemd ignores the exit status on
# purpose. That makes an alert row the only surface a parent would ever see.
n=$(sql "SELECT count(*) FROM alerts WHERE category='alert-check' AND NOT acknowledged" | head -1)
[ "$n" = 1 ] && ok "a broken alert check raises an urgent alert of its own" \
             || bad "a broken alert check raised $n alerts about itself, expected 1"
sev=$(sql "SELECT severity FROM alerts WHERE category='alert-check' ORDER BY ts DESC LIMIT 1" | head -1)
[ "$sev" = urgent ] && ok "and it is urgent" || bad "it was raised as '$sev', not urgent"

# And a good run retires it, or the parent learns to ignore a red banner.
run_alerts >/dev/null
n=$(sql "SELECT count(*) FROM alerts WHERE category='alert-check' AND NOT acknowledged" | head -1)
[ "$n" = 0 ] && ok "the next good run retires it" \
             || bad "$n alert-check warning(s) survived a good run"

# ---- the interval gate ------------------------------------------------------
o=$(ALERT_LOOKBACK="15 minutes; DROP TABLE alerts" GENKAN_DB="$DB" PG_CONTAINER="$PG" \
    GENKAN_DB_ROLE=postgres bash "$R/bin/genkan-alerts" 2>&1); rc=$?
[ "$rc" != 0 ] && ok "an injected lookback is refused" \
               || bad "an injected lookback was accepted"
t=$(sql "SELECT to_regclass('public.alerts') IS NOT NULL" | head -1)
[ "$t" = t ] && ok "and the alerts table is still there" \
             || bad "the alerts table was dropped"

# ---- one real AdGuard entry, through the real ingest ------------------------
# Every case above writes its own dns_log rows with now(), which is exactly how
# the twelve-hour bug hid (DECISIONS.md, "The DNS log was twelve hours in the
# past"): the ingest stored AdGuard's UTC stamp as local time, no alert could
# ever see a lookup inside its window, and a test that fabricated its rows
# passed the whole time. So this feeds one entry shaped exactly like AdGuard's
# (UTC, Z suffix, nanoseconds) through genkan-dnslog itself, from a stand-in
# AdGuard on a local port, and checks the row it stored is stamped now, with
# the reason and the blocklist name kept.
port=$(( 20000 + RANDOM % 20000 ))
fake="$(mktemp)"
cat > "$fake" <<'PY'
import json, sys, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
port = int(sys.argv[1]); domain = sys.argv[2]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/control/filtering/status"):
            body = {"filters": [{"id": 1001, "name": "OISD NSFW (adult)", "enabled": True}], "user_rules": []}
        elif self.path.startswith("/control/querylog") and "older_than" not in self.path:
            now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.123456789Z")
            body = {"data": [{"time": now, "client": "192.0.2.77", "reason": "FilteredBlackList",
                              "rules": [{"filter_list_id": 1001, "text": "||" + domain + "^"}],
                              "question": {"name": domain + ".", "type": "A"}, "status": "NOERROR"}],
                    "oldest": ""}
        else:
            body = {"data": [], "oldest": ""}
        out = json.dumps(body).encode()
        self.send_response(200); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out))); self.end_headers(); self.wfile.write(out)
HTTPServer(("127.0.0.1", port), H).serve_forever()
PY
python3 "$fake" "$port" "$pat" >/dev/null 2>&1 &
fakepid=$!
trap 'kill $fakepid 2>/dev/null; rm -f "$broken" "$fake"; cleanup' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s --max-time 1 "http://127.0.0.1:$port/control/filtering/status" >/dev/null 2>&1 && break; sleep 0.3
done
sql "INSERT INTO devices(child_id,mac,label,reserved_ip) VALUES($kid,'aa:bb:cc:dd:ee:02','tablet','192.0.2.77')" >/dev/null
o=$(ADGUARD_URL="http://127.0.0.1:$port" ADGUARD_USER=x ADGUARD_PASS=x GENKAN_DB="$DB" PG_CONTAINER="$PG" \
    GENKAN_DB_ROLE=postgres bash "$R/bin/genkan-dnslog" 2>&1); rc=$?
[ "$rc" = 0 ] && ok "genkan-dnslog ingested a stand-in AdGuard entry" \
              || bad "genkan-dnslog failed on a stand-in AdGuard entry: ${o:0:90}"
skew=$(sql "SELECT abs(extract(epoch FROM (now() - ts)))::int FROM dns_log WHERE client_ip='192.0.2.77' ORDER BY id DESC LIMIT 1" | head -1)
[ -n "$skew" ] && [ "$skew" -lt 60 ] \
  && ok "an AdGuard UTC stamp is stored as now, not twelve hours away (off by ${skew}s)" \
  || bad "the ingested row is ${skew:-missing} seconds from now: the UTC stamp was read as local time"
why=$(sql "SELECT reason || '|' || COALESCE(filter_list,'') || '|' || action FROM dns_log WHERE client_ip='192.0.2.77' ORDER BY id DESC LIMIT 1" | head -1)
[ "$why" = "FilteredBlackList|OISD NSFW (adult)|blocked" ] \
  && ok "and it kept AdGuard's reason and the name of the list that matched" \
  || bad "reason, list or action came through wrong: '$why'"
who=$(sql "SELECT device_id FROM dns_log WHERE client_ip='192.0.2.77' ORDER BY id DESC LIMIT 1" | head -1)
[ -n "$who" ] && ok "and attributed it to the device with that reserved address" \
              || bad "the row was not attributed to the device that owns 192.0.2.77"
# The row is a flagged domain inside the window, so the alert path now runs on
# a row the ingest wrote rather than one the test wrote.
run_alerts >/dev/null
n=$(sql "SELECT count(*) FROM alerts WHERE child_id=$kid AND domain='$pat'" | head -1)
[ "$n" -ge 1 ] && ok "the alert check sees a row the real ingest wrote" \
               || bad "no alert followed the ingested row ($n alerts)"

# ---- and no other script has the same bug -----------------------------------
# The comment that broke this path was legal bash and looked right in an
# editor. A scanner is the only thing that keeps it from happening in the next
# script, so the sweep runs with the suite rather than once, by hand, today.
if command -v python3 >/dev/null; then
  o=$(cd "$R" && python3 tools/lint-sql-comments.py 2>&1)
  case "$o" in *"--- 0 "*) ok "no script has a '#' comment inside a SQL string";;
               *) bad "a '#' comment sits inside a SQL string: $(echo "$o" | head -1)";; esac
else
  bad "python3 is missing, so the repo-wide sweep did not run"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
