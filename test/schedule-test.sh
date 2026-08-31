#!/usr/bin/env bash
# genkan:summary=Proves scheduled bedtimes: the times, the morning restore, and who may lift what.
#
# A bedtime is the one feature in Genkan that can leave a child with no internet
# because nobody was watching. Nearly all of the risk is in two places:
#
#   1. THE TIME MATHS. A Friday night is not a Tuesday night, a window that
#      crosses midnight belongs to the evening it started in, and a school
#      holiday must not need six schedules edited. None of that can be proven by
#      waiting for Friday, so the maths lives in a database function that takes
#      the moment as an argument, and this file hands it fixed moments.
#
#   2. WHO MAY LIFT WHAT. category_state.set_by decides. A schedule owns only
#      set_by='bedtime'. It must never lift a parent's block, an out-of-time
#      block or an over-budget one, a parent's override must survive the worker's
#      next tick, earning time back must not buy a way past bedtime, and a
#      restart mid-bedtime must come back blocked. Every one of those is a check
#      below, because every one of them is a way to be wrong at eleven at night.
#
# IT NEVER TOUCHES THE HOUSEHOLD DATABASE. It creates its own, loads the real
# schema files into it, invents a family, and points bin/genkan-schedule and
# bin/kidnet at that database with GENKAN_DB. The firewall is pointed at a
# container that does not exist, so nothing can reach nftables either.
#
#   sudo not required. Needs docker and a running postgres container.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_schedule_test_$$"
for _t in docker; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

# The one line that matters if somebody edits this file later.
case "$DB" in kids_network) echo "REFUSING: this suite must never run against the household database"; exit 1;; esac

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
run(){ docker exec -i "$PG" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; }
trap cleanup EXIT

# The worker and the CLI, pointed at the throwaway database and at a firewall
# that is not there. GW_CONTAINER is deliberately a name no container has: if a
# future change made kidnet touch nftables on a path it should not, this suite
# would fail rather than quietly reach into the live island.
WORKER(){ PG_CONTAINER="$PG" GENKAN_DB="$DB" GENKAN_DB_ROLE="$ROLE" \
          GW_CONTAINER=genkan-test-no-such-container ADGUARD_PASS="" \
          bash "$R/bin/genkan-schedule" "$@" 2>&1; }
KIDNET(){ PG_CONTAINER="$PG" GENKAN_DB="$DB" GENKAN_DB_ROLE="$ROLE" \
          GW_CONTAINER=genkan-test-no-such-container ADGUARD_PASS="" \
          bash "$R/bin/kidnet" "$@" 2>&1; }

echo
echo "Scheduled bedtimes, on a database of their own"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
# The household's own timezone, because a bedtime is a local-time idea and the
# Postgres container runs UTC. deploy.sh pins this on a real box.
run "ALTER DATABASE $DB SET timezone = 'Pacific/Auckland';"

out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
if echo "$out" | grep -q FAILED; then
  bad "the schema loads"; echo "$out" | grep FAILED | sed 's/^/      /'; echo; echo "passed $pass, failed $fail"; exit 1
else ok "the schema loads"; fi

# Run the worker as the least-privilege role if config/db/grants.sql applies
# cleanly, because that is how it runs on a real box and a missing grant is a
# real bug. Fall back to the superuser rather than failing the whole suite on
# somebody else's file, and say which one happened.
ROLE=postgres
if [ -f "$R/config/db/grants.sql" ] \
   && docker exec -i "$PG" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 < "$R/config/db/grants.sql" >/dev/null 2>&1; then
  ROLE=kids_agent
  ok "the worker runs as kids_agent, with only the grants config/db/grants.sql gives it"
else
  ok "the worker runs as the superuser (config/db/grants.sql did not apply here)"
fi

# A made-up family: a sixteen-year-old and an eleven-year-old, who do not go to
# bed at the same time, which is the whole point of a per-child schedule.
run "INSERT INTO children(id,name,age,policy_tier,kind,active) VALUES
       (901,'Older',16,'teen','child',true),
       (902,'Younger',11,'young','child',true);"
OLD=901; YNG=902

# An existing household that pulled the repo but has not deployed has none of
# these tables. The worker must say so in words and exit clean, because a timer
# that fails every minute with a psql trace teaches a household to ignore its
# own journal.
bare="genkan_schedule_bare_$$"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $bare;" >/dev/null 2>&1
out=$(PG_CONTAINER="$PG" GENKAN_DB="$bare" GENKAN_DB_ROLE=postgres GW_CONTAINER=nope       bash "$R/bin/genkan-schedule" apply 2>&1); rc=$?
docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $bare;" >/dev/null 2>&1
case "$out$rc" in *"no bedtime tables"*0) ok "a database without the tables gets a sentence, not a trace, and exit 0";;
  *) bad "a database without the bedtime tables produced: rc=$rc $out";; esac

# ---------------------------------------------------------------------------
echo
echo "The times themselves, at fixed moments"
# ---------------------------------------------------------------------------
# 0=Sunday. Days are the night the window STARTS on, so school nights are the
# nights before a school day: Sunday through Thursday.
#   Older:   school nights 22:00 to 07:00, weekends 23:30 to 09:00
#   Younger: school nights 20:30 to 07:00, weekends 21:30 to 08:00
run "INSERT INTO schedules(id,child_id,name,days,start_min,end_min,action,enabled,categories) VALUES
  (9101,$OLD,'school-night bedtime',ARRAY[0,1,2,3,4],1320,420,'block',true,ARRAY['internet']),
  (9102,$OLD,'weekend bedtime',      ARRAY[5,6],     1410,540,'block',true,ARRAY['internet']),
  (9103,$YNG,'school-night bedtime',ARRAY[0,1,2,3,4],1230,420,'block',true,ARRAY['internet']),
  (9104,$YNG,'weekend bedtime',      ARRAY[5,6],     1290,480,'block',true,ARRAY['internet']);"

# 2026-09-01 is a Tuesday, 2026-09-04 a Friday, 2026-09-05 a Saturday.
inwin(){ psql "SELECT count(*) FROM schedule_windows('$2'::timestamptz) w
               WHERE w.in_window AND w.child_id=$1"; }
chk(){ # description, expected, actual
  [ "$3" = "$2" ] && ok "$1" || bad "$1 (expected $2, got $3)"; }

chk "a school night: Younger is off at 21:00 on a Tuesday" 1 "$(inwin $YNG '2026-09-01 21:00+12')"
chk "a school night: Older is still on at 21:00 on a Tuesday" 0 "$(inwin $OLD '2026-09-01 21:00+12')"
chk "a school night: Older goes off at 22:00 too" 1 "$(inwin $OLD '2026-09-01 22:00+12')"
chk "before bedtime nobody is off (Tuesday 19:00)" 0 "$(inwin $YNG '2026-09-01 19:00+12')"

chk "the morning after: still off at 06:30 on the Wednesday" 1 "$(inwin $YNG '2026-09-02 06:30+12')"
chk "the morning after: back on at 07:30 on the Wednesday" 0 "$(inwin $YNG '2026-09-02 07:30+12')"
chk "the morning after: Older is back on at 07:30 too" 0 "$(inwin $OLD '2026-09-02 07:30+12')"

# The heart of it. At 22:30 on a Friday the school-night rule must not fire, and
# the weekend rule has not started yet.
chk "a Friday night is not a Tuesday night: Older is on at 22:30" 0 "$(inwin $OLD '2026-09-04 22:30+12')"
chk "a Friday night: Younger is off at 22:30, on their weekend time" 1 "$(inwin $YNG '2026-09-04 22:30+12')"
chk "a Friday night: Older goes off at 23:30" 1 "$(inwin $OLD '2026-09-04 23:30+12')"
chk "a Saturday morning: Younger is still off at 07:30" 1 "$(inwin $YNG '2026-09-05 07:30+12')"
chk "a Saturday morning: Younger is back at 08:30, later than a school day" 0 "$(inwin $YNG '2026-09-05 08:30+12')"
chk "a Saturday morning: Older is back at 09:30" 0 "$(inwin $OLD '2026-09-05 09:30+12')"

# The window a parent is shown has to be the window that is enforced, or the
# portal tells a child one thing and the firewall does another.
t=$(psql "SELECT to_char(min(ends_at),'HH24:MI') FROM schedule_windows('2026-09-01 22:30+12')
          WHERE in_window AND child_id=$OLD")
chk "Older is told they are back at 07:00" "07:00" "$t"

# ---------------------------------------------------------------------------
echo
echo "Holidays, and tonight's extension"
# ---------------------------------------------------------------------------
run "INSERT INTO schedule_overrides(child_id,name,starts,ends,mode)
     VALUES (NULL,'school holidays','2026-09-28','2026-10-09','off');"
chk "school holidays: no bedtime on a Tuesday inside the window" 0 "$(inwin $YNG '2026-09-29 22:00+13')"
chk "school holidays: the ordinary Tuesday outside it is untouched" 1 "$(inwin $YNG '2026-09-01 22:00+12')"

# One child can be held to their bedtime through the household's holiday. A row
# naming a child beats a household-wide row.
run "INSERT INTO schedule_overrides(child_id,name,starts,ends,mode,shift_min)
     VALUES ($YNG,'still school-ish','2026-09-28','2026-10-09','late',60);"
chk "the younger one still goes off in the holidays, an hour later" 0 "$(inwin $YNG '2026-09-29 21:00+13')"
chk "and is off once that hour is up" 1 "$(inwin $YNG '2026-09-29 21:45+13')"
run "DELETE FROM schedule_overrides;"

# An extension is one absolute moment, so it can only affect the window it lands
# inside, and tomorrow is untouched without anything having to clean it up.
run "INSERT INTO schedule_extensions(child_id,until_ts,minutes,reason,granted_by)
     VALUES ($YNG,'2026-09-01 22:00+12',90,'a film','test');"
chk "tonight's extension: Younger stays on at 21:00" 0 "$(inwin $YNG '2026-09-01 21:00+12')"
chk "tonight's extension: and goes off at 22:00 when it runs out" 1 "$(inwin $YNG '2026-09-01 22:00+12')"
chk "tonight's extension: tomorrow night is unchanged" 1 "$(inwin $YNG '2026-09-02 21:00+12')"
run "DELETE FROM schedule_extensions;"

# ---------------------------------------------------------------------------
echo
echo "The worker: what it blocks, what it lifts, and what it must not touch"
# ---------------------------------------------------------------------------
# The worker reads the real clock, so the schedules below are built AROUND the
# clock: a window from thirty minutes ago to thirty minutes from now is running
# whatever the time is, and one from two hours ago to an hour ago is over. The
# maths those minutes go through has just been proven above at fixed moments.
setwin(){ # child, minutes-from-now for the start, minutes-from-now for the end
  run "DELETE FROM schedules WHERE child_id=$1;"
  run "INSERT INTO schedules(child_id,name,days,start_min,end_min,action,enabled,categories)
       SELECT $1,'bedtime',ARRAY[0,1,2,3,4,5,6],
         ((EXTRACT(HOUR FROM now())*60+EXTRACT(MINUTE FROM now()))::int + ($2) + 1440) % 1440,
         ((EXTRACT(HOUR FROM now())*60+EXTRACT(MINUTE FROM now()))::int + ($3) + 1440) % 1440,
         'block', true, ARRAY['internet']::text[];"; }
state(){ psql "SELECT COALESCE(blocked::text,'-')||'/'||COALESCE(set_by,'-')
               FROM category_state WHERE child_id=$1 AND category='internet'"; }

run "DELETE FROM schedules; DELETE FROM schedule_state; DELETE FROM category_state;"

setwin $YNG -30 30
WORKER apply >/dev/null
chk "bedtime arrives: Younger is blocked, marked 'bedtime'" "true/bedtime" "$(state $YNG)"
chk "and nobody else is touched" "" "$(state $OLD)"
n=$(psql "SELECT count(*) FROM block_events WHERE source='schedule' AND action='off'")
chk "the audit trail records who did it" 1 "$n"

WORKER apply >/dev/null; WORKER apply >/dev/null
chk "running again changes nothing" "true/bedtime" "$(state $YNG)"

# A RESTART MID-BEDTIME. The block is a database row and the gateway rebuilds
# the firewall from it, so the honest simulation of the worst case is: the row
# is gone AND the worker has no memory of the night. It must come back blocked,
# because no memory has to mean assert.
run "UPDATE category_state SET blocked=false, set_by='reset' WHERE child_id=$YNG;"
run "DELETE FROM schedule_state;"
WORKER apply >/dev/null
chk "a restart at 11pm comes back to the bedtime, not to the internet" "true/bedtime" "$(state $YNG)"

# A PARENT OVERRIDES. This has to survive the worker's next tick, or the parent
# watches the internet die again sixty seconds after they turned it on.
KIDNET on Younger >/dev/null
chk "a parent turns it back on" "false/agent" "$(state $YNG)"
WORKER apply >/dev/null
chk "the worker does not stamp it back a minute later" "false/agent" "$(state $YNG)"
WORKER apply >/dev/null; WORKER apply >/dev/null
chk "nor five minutes later" "false/agent" "$(state $YNG)"
n=$(psql "SELECT count(*) FROM schedule_state WHERE child_id=$YNG AND released_key IS NOT NULL")
chk "the release is recorded against tonight's window, not left to memory" 1 "$n"

# A restart does not cancel the parent's override either: the release is a row.
run "DELETE FROM block_events WHERE source='schedule';"
WORKER apply >/dev/null
chk "and it survives a restart, because the release is in the database too" "false/agent" "$(state $YNG)"

# THE NEXT BOUNDARY ends the override. A new window means a new key, so the
# bedtime is asserted again tomorrow night without anybody clearing anything.
run "UPDATE schedule_state SET window_key='old:2000-01-01', released_key='old:2000-01-01'
      WHERE child_id=$YNG;"
WORKER apply >/dev/null
chk "tomorrow night the bedtime is back on" "true/bedtime" "$(state $YNG)"

# THE MORNING RESTORE. The window ends; nothing else has to happen.
setwin $YNG -120 -60
WORKER apply >/dev/null
chk "morning: the bedtime lifts on its own" "false/schedule-lifted" "$(state $YNG)"
n=$(psql "SELECT count(*) FROM block_events WHERE source='schedule' AND action='on'")
chk "and the morning is audited as well as the night" 1 "$n"

# A schedule that is deleted, disabled or edited mid-window must not strand a
# child. The lift is driven off category_state, not off the schedules table.
setwin $YNG -30 30
WORKER apply >/dev/null
chk "blocked again for the next test" "true/bedtime" "$(state $YNG)"
run "DELETE FROM schedules WHERE child_id=$YNG;"
WORKER apply >/dev/null
chk "deleting the schedule mid-bedtime lets the child back on" "false/schedule-lifted" "$(state $YNG)"

# ---------------------------------------------------------------------------
echo
echo "set_by precedence: what a schedule is not allowed to do"
# ---------------------------------------------------------------------------
run "DELETE FROM schedules; DELETE FROM schedule_state; DELETE FROM category_state;"

# A PARENT'S BLOCK IS NOT LIFTED BY MORNING. If Dad said no gaming today, the
# sun coming up does not undo it.
run "INSERT INTO category_state(child_id,category,blocked,set_by)
     VALUES ($YNG,'gaming',true,'agent'), ($YNG,'internet',true,'agent');"
setwin $YNG -120 -60
WORKER apply >/dev/null
chk "morning does not lift a block a parent applied by hand" "true/agent" "$(state $YNG)"
g=$(psql "SELECT blocked::text||'/'||set_by FROM category_state WHERE child_id=$YNG AND category='gaming'")
chk "and no gaming today still means no gaming today" "true/agent" "$g"

# OUT OF TIME IS NOT THE SCHEDULE'S TO LIFT EITHER.
run "UPDATE category_state SET set_by='out-of-time' WHERE child_id=$YNG AND category='internet';"
WORKER apply >/dev/null
chk "morning does not hand back time the meter took" "true/out-of-time" "$(state $YNG)"

# A CATEGORY OVER ITS BUDGET IS THE METER'S, NOT THE SCHEDULE'S.
run "UPDATE category_state SET set_by='over-budget' WHERE child_id=$YNG AND category='gaming';"
WORKER apply >/dev/null
g=$(psql "SELECT blocked::text||'/'||set_by FROM category_state WHERE child_id=$YNG AND category='gaming'")
chk "morning does not hand back a category that ran over its cap" "true/over-budget" "$g"

# EARNING TIME BACK MUST NOT BUY A WAY PAST BEDTIME. This is the one that was
# actually broken: `kidnet bonus` and `kidnet earn` called `kidnet on`, which
# stamps set_by='agent' over anything, bedtime included.
run "DELETE FROM category_state;"
setwin $YNG -30 30
WORKER apply >/dev/null
chk "bedtime is on" "true/bedtime" "$(state $YNG)"
KIDNET bonus Younger 30 "a bribe" >/dev/null
chk "a parent's bonus does not cancel bedtime" "true/bedtime" "$(state $YNG)"
KIDNET earn Younger 20 >/dev/null
chk "and neither does earning time" "true/bedtime" "$(state $YNG)"

# The same lift must still work for the thing it IS for: running out of time.
run "UPDATE category_state SET blocked=true, set_by='out-of-time' WHERE child_id=$YNG AND category='internet';"
KIDNET reopen Younger >/dev/null
chk "but earning still reopens a child who was only out of time" "false/earned-back" "$(state $YNG)"

# ---------------------------------------------------------------------------
echo
echo "What a parent and a child are told"
# ---------------------------------------------------------------------------
run "DELETE FROM schedules; DELETE FROM schedule_state; DELETE FROM category_state;"
setwin $YNG 30 90
n=$(psql "SELECT count(*) FROM schedule_next WHERE child_id=$YNG AND NOT in_window")
chk "before bedtime the child is told when it starts" 1 "$n"
setwin $YNG -30 30
WORKER apply >/dev/null
n=$(psql "SELECT count(*) FROM schedule_next WHERE child_id=$YNG AND in_window AND ends_at > now()")
chk "during bedtime the child is told when they are back" 1 "$n"
n=$(psql "SELECT count(*) FROM schedule_holding WHERE child_id=$YNG AND category='internet'")
chk "the dashboard can say the block is a bedtime, not a punishment" 1 "$n"
n=$(psql "SELECT count(*) FROM schedule_next WHERE child_id=$OLD")
chk "a child with no bedtime is told nothing, rather than something wrong" 0 "$n"

# A guest who has gone home keeps their row so that bringing them back is one
# command. They must not keep their bedtime.
setwin $YNG -30 30
WORKER apply >/dev/null
chk "in a bedtime before they leave" "true/bedtime" "$(state $YNG)"
run "UPDATE children SET active=false WHERE id=$YNG;"
WORKER apply >/dev/null
chk "somebody who has gone home is let off their bedtime" "false/schedule-lifted" "$(state $YNG)"
n=$(psql "SELECT count(*) FROM schedule_next WHERE child_id=$YNG")
chk "and is no longer told about one" 0 "$n"
run "UPDATE children SET active=true WHERE id=$YNG;"

# The CLI a tired parent uses at half past eight. The point of an extension is
# that it changes tonight and nothing else, so the schedule row must come out
# of it byte for byte the same.
setwin $YNG -30 120
before=$(psql "SELECT md5(string_agg(id||days::text||start_min||end_min||enabled::text,'|' ORDER BY id))
               FROM schedules WHERE child_id=$YNG")
WORKER extend Younger 45 >/dev/null 2>&1
n=$(psql "SELECT count(*) FROM schedule_extensions WHERE child_id=$YNG")
chk "a parent can grant tonight's extension without editing the schedule" 1 "$n"
after=$(psql "SELECT md5(string_agg(id||days::text||start_min||end_min||enabled::text,'|' ORDER BY id))
              FROM schedules WHERE child_id=$YNG")
chk "and the schedule itself comes out of it unchanged" "$before" "$after"
# An extension that would run past the far end of the bedtime is refused rather
# than silently granting the whole night.
out=$(WORKER extend Younger 600 2>&1 || true)
case "$out" in *"longer than"*) ok "an absurd extension is refused, and says why";;
  *) bad "an extension longer than the bedtime was not refused clearly: $out";; esac

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
