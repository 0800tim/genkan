#!/usr/bin/env bash
# genkan:summary=A fresh install must load. Proves the schema order on an empty database.
#
# This exists because the order documented in docs/DATABASE.md was wrong, and
# nothing noticed. Every existing suite runs against THIS box's database, which
# was built up over months, so none of them would ever have caught it. The
# first thing a stranger does is the one thing that was never tested.
#
#   sudo not required. Needs docker and a running postgres container.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_schema_test_$$"
for _t in docker; do command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }; done

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; }
trap cleanup EXIT

echo
echo "A fresh install, from an empty database"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }

out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
if echo "$out" | grep -q FAILED; then
  bad "every schema file loads"; echo "$out" | grep FAILED | sed 's/^/      /'
else ok "every schema file loads"; fi

# The tables and views the dashboard and the portal actually open on start.
for rel in children devices people household_roster device_roster time_remaining \
           category_state time_ledger earn_claims task_offer_effective \
           device_policy_effective quiz_settings alerts category_ips \
           quiz_banks quiz_bank_questions quiz_bank_summary earn_settings \
           quiz_packages quiz_package_summary \
           earn_settings_effective child_badges quiz_study_visits board_settings \
           schedules schedule_overrides schedule_extensions schedule_state \
           schedule_next schedule_holding \
           device_sweeps device_state house_state house_status blocked_device_ips \
           notify_routes notify_wording notify_sent notify_log notify_pending notify_route_state; do
  [ "$(psql "SELECT to_regclass('public.$rel') IS NOT NULL")" = t ] \
    && ok "$rel exists" || bad "$rel is missing after a fresh load"
done

# Seed data a fresh install needs to do anything at all.
n=$(psql "SELECT count(*) FROM category_domains")
[ "${n:-0}" -gt 100 ] && ok "the category domain map is seeded ($n domains)" \
  || bad "category_domains has only ${n:-0} rows, so a fresh install meters nothing"
n=$(psql "SELECT count(*) FROM services")
[ "${n:-0}" -gt 20 ] && ok "the service list is seeded ($n services)" \
  || bad "services has only ${n:-0} rows"
# The three child levels come from seed.sql. Without them a parent cannot give
# a child a budget, because kidnet joins policies on the child's tier.
for t in young standard teen guest adult; do
  [ "$(psql "SELECT count(*) FROM policies WHERE tier='$t'")" = 1 ] \
    && ok "the '$t' filter level exists" || bad "no '$t' filter level after a fresh load"
done
# The safety net is an iron rule: a cut-off child must still reach a help line.
# The reading list: a child out of time can still go and learn something.
# Nothing pruned anything until 2026-08-30. A child's whole browsing history
# accumulating forever is not what a parent agreed to, even in their own house.
n=$(psql "SELECT count(*) FROM retention")
[ "${n:-0}" -ge 8 ] && ok "retention is defined for $n tables" \
  || bad "only ${n:-0} retention rules, so something grows without limit"
[ "$(psql "SELECT keep_days FROM retention WHERE what='dns_log'")" -le 90 ] \
  && ok "the DNS log, the most sensitive table, is kept the shortest" \
  || bad "dns_log retention is longer than 90 days"
# The storage view the Settings page and `genkan retention show` read: one
# sized row per retention row, so a parent can see what each rule is holding.
[ "$(psql "SELECT count(*) FROM storage_status WHERE bytes IS NOT NULL")" = "$n" ] \
  && ok "storage_status has a sized row for every retention rule" \
  || bad "storage_status does not cover every retention rule"

# The pruner, end to end, on this throwaway. Two lookups: one older than its
# retention, one from now. The old one goes, the new one stays, and the
# deletion is audited in block_events in the same statement as the delete.
psql "INSERT INTO dns_log(ts,domain,action) VALUES (now()-interval '400 days','old.example','allowed'),(now(),'new.example','allowed')" >/dev/null
out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" bash "$R/bin/genkan-prune" --dry-run 2>&1)
case "$out" in *"would delete 1 row(s) from dns_log"*) ok "genkan-prune --dry-run sees the row past its retention";;
                *) bad "genkan-prune --dry-run did not see it: ${out:0:80}";; esac
[ "$(psql "SELECT count(*) FROM dns_log")" = 2 ] && ok "a dry run deleted nothing" || bad "a dry run deleted something"
out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" bash "$R/bin/genkan-prune" 2>&1)
[ "$(psql "SELECT count(*) FROM dns_log WHERE domain='new.example'")" = 1 ] \
  && [ "$(psql "SELECT count(*) FROM dns_log WHERE domain='old.example'")" = 0 ] \
  && ok "the nightly prune deleted the old lookup and kept the new one" \
  || bad "the nightly prune got the wrong rows: ${out:0:80}"
[ "$(psql "SELECT count(*) FROM block_events WHERE target_ref='prune:dns_log' AND action='deleted:1' AND source='nightly'")" = 1 ] \
  && ok "the deletion is audited in block_events" || bad "no audit row for the nightly deletion"
# A one-off (`genkan prune dns-log <days>`): deletes only what is older than
# the days it was given, and leaves the retention rule alone.
psql "INSERT INTO dns_log(ts,domain,action) VALUES (now()-interval '10 days','older.example','allowed')" >/dev/null
out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" bash "$R/bin/genkan-prune" dns_log 7 2>&1)
[ "$(psql "SELECT count(*) FROM dns_log")" = 1 ] \
  && ok "a one-off prune deletes only what is older than the days it was given" \
  || bad "a one-off prune got the wrong rows: ${out:0:80}"
[ "$(psql "SELECT keep_days FROM retention WHERE what='dns_log'")" = 30 ] \
  && ok "a one-off prune leaves the retention rule alone" || bad "a one-off prune changed the retention rule"
out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" bash "$R/bin/genkan-prune" dns_log 0 2>&1); rc=$?
[ "$rc" != 0 ] && ok "genkan-prune refuses 0 days" || bad "genkan-prune accepted 0 days"
out=$(GENKAN_DB="$DB" PG_CONTAINER="$PG" bash "$R/bin/genkan-prune" children 30 2>&1); rc=$?
[ "$rc" != 0 ] && [ "$(psql "SELECT count(*) FROM children")" -gt 0 ] \
  && ok "genkan-prune refuses a table with no retention rule" || bad "genkan-prune touched a table with no retention rule"

n=$(psql "SELECT count(*) FROM always_allow WHERE scope='learn'")
[ "${n:-0}" -gt 5 ] && ok "the reading list is seeded ($n reference sites a blocked child can read)" \
  || bad "always_allow has ${n:-0} learn rows, so learn-to-earn is a memory test"
# The international reading list (schema-learn-intl.sql): NZ, AU, UK and US
# study and reference sites, on top of the core fifteen in schema-learn.sql.
n=$(psql "SELECT count(*) FROM always_allow WHERE scope='learn' AND domain IN (
  'www2.nzqa.govt.nz','tahurangi.education.govt.nz','nzhistory.govt.nz',
  'aotearoahistories.education.govt.nz','tepapa.govt.nz','collections.tepapa.govt.nz',
  'australiancurriculum.edu.au','educationstandards.nsw.edu.au','csiro.au','ga.gov.au',
  'bom.gov.au','library.gov.au','australian.museum','naa.gov.au',
  'nationalarchives.gov.uk','bl.uk','rmg.co.uk','nrich.maths.org','nationalgallery.org.uk','stem.org.uk',
  'loc.gov','learninglab.si.edu','noaa.gov','www.usgs.gov','archives.gov','merriam-webster.com')")
[ "${n:-0}" -gt 20 ] && ok "the international reading list is seeded ($n NZ/AU/UK/US sites beyond the core fifteen)" \
  || bad "the international reading list has only ${n:-0} rows; schema-learn-intl.sql may not have loaded"
n=$(psql "SELECT count(*) FROM always_allow WHERE scope='safety'")
[ "${n:-0}" -gt 0 ] && ok "the safety net is seeded ($n domains a blocked child can still reach)" \
  || bad "always_allow has no safety rows, so a cut-off child could not reach a help line"
# The Settings page (schema-settings.sql): the filter levels carry their
# AdGuard half, filled with exactly what genkan-adguard-clients used to
# hard-code, and the trigger that keeps the safety net whole is in place.
n=$(psql "SELECT count(*) FROM policies WHERE adguard_parental IS NOT NULL AND adguard_services IS NOT NULL")
[ "${n:-0}" -ge 5 ] && ok "every filter level carries its AdGuard settings ($n levels)" \
  || bad "only ${n:-0} filter levels carry AdGuard settings; schema-settings.sql may not have loaded"
[ "$(psql "SELECT array_length(adguard_services,1) FROM policies WHERE tier='young'")" = 12 ] \
  && ok "the young level blocks the twelve services it always did" \
  || bad "the young level's blocked services are not the shipped twelve"
[ "$(psql "SELECT adguard_parental::text||' '||safesearch::text FROM policies WHERE tier='teen'")" = "false false" ] \
  && ok "the teen level is light touch, as it always was (no parental control, no SafeSearch)" \
  || bad "the teen level's filter changed on load"
[ "$(psql "SELECT adguard_private FROM policies WHERE tier='guest'")" = t ] \
  && ok "the guest level keeps visitors out of the per-client log" \
  || bad "the guest level is no longer private"
out=$(psql "DELETE FROM always_allow WHERE domain='1737.org.nz'")
case "$out" in *"safety net"*) ok "the safety net cannot be narrowed, even by the superuser (trigger)";;
  *) bad "a safety row could be deleted: ${out:0:80}";; esac
n=$(psql "SELECT count(*) FROM always_allow WHERE category='search'")
[ "${n:-0}" -ge 10 ] && ok "the Google search hosts are seeded ($n exact hosts)" \
  || bad "only ${n:-0} search hosts, so a cut child cannot search"
n=$(psql "SELECT count(*) FROM vendor_clouds")
[ "${n:-0}" -gt 10 ] && ok "smart-home vendor clouds are seeded ($n)" || bad "vendor_clouds has ${n:-0} rows"
# Scheduled bedtimes. The time maths lives in a database function so it can be
# proven without waiting for Friday night; test/schedule-test.sh does that. Here
# we only prove the function loaded and that a fresh install schedules nothing.
[ "$(psql "SELECT count(*) FROM pg_proc WHERE proname='schedule_windows'")" = 1 ] \
  && ok "the schedule_windows() time function exists" \
  || bad "schedule_windows() is missing, so bin/genkan-schedule has nothing to read"
n=$(psql "SELECT count(*) FROM schedules")
[ "${n:-0}" = 0 ] && ok "a fresh install has no bedtimes set" \
  || bad "a fresh install ships ${n:-0} schedule(s), and a bedtime nobody asked for is somebody's kid offline"
# The comparison board is off until a parent turns it on: see the note at the
# top of schema-badges.sql for why. A fresh install must not wake a sibling
# rivalry nobody asked for.
# Shared family devices and the two sweeps (schema-shared.sql). A fresh install
# must have the house ON: an install that arrives mid-outage is somebody's whole
# family offline for a reason nobody chose.
[ "$(psql "SELECT is_off FROM house_status")" = f ] \
  && ok "a fresh install has the house on, not cut off" \
  || bad "a fresh install has the whole-house cut RUNNING, and nobody asked for that"
# THE IRON RULE, proven rather than asserted. Put one device of every class on
# the wire, force both tick boxes ON for all of them, and check that the three
# classes that must never be cut are in neither sweep anyway. This is the guard
# that stops a dinner pause darkening the front door lock, and a schema change
# that quietly drops it would otherwise be invisible until somebody's camera
# went out mid-evening.
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,is_active,last_seen)
      VALUES ('fe:ed:5a:00:00:01','st personal','192.168.60.241','phone','personal',true,now()),
             ('fe:ed:5a:00:00:02','st shared','192.168.60.242','tv','shared',true,now()),
             ('fe:ed:5a:00:00:03','st lock','192.168.60.243','lock','iot',true,now()),
             ('fe:ed:5a:00:00:04','st server','192.168.60.244','other','appliance',true,now()),
             ('fe:ed:5a:00:00:05','st ap','192.168.60.245','ap','infra',true,now())" >/dev/null
psql "UPDATE devices SET caught_by_dinner=true, caught_by_house_off=true
       WHERE mac::text LIKE 'fe:ed:5a:%'" >/dev/null
for c in iot appliance infra; do
  n=$(psql "SELECT count(*) FROM device_sweeps s JOIN devices d ON d.id=s.device_id
            WHERE d.mac::text LIKE 'fe:ed:5a:%' AND d.category='$c'
              AND (s.in_dinner OR s.in_house_off)")
  [ "${n:-1}" = 0 ] && ok "a '$c' device is in no sweep even with both boxes forced on" \
    || bad "a '$c' device is in a sweep; a dinner pause could darken the lock or the camera"
done
for c in personal shared; do
  n=$(psql "SELECT count(*) FROM device_sweeps s JOIN devices d ON d.id=s.device_id
            WHERE d.mac::text LIKE 'fe:ed:5a:%' AND d.category='$c' AND s.in_dinner AND s.in_house_off")
  [ "${n:-0}" = 1 ] && ok "a '$c' device defaults into both sweeps" \
    || bad "a '$c' device is not in both sweeps by default"
done
# And the same guard where it actually bites: the addresses a scope resolves to.
for c in 192.168.60.243 192.168.60.244 192.168.60.245; do
  n=$(psql "SELECT count(*) FROM ips_in_scope('house-off') WHERE ip='$c'")
  [ "${n:-1}" = 0 ] && ok "$c is not in the whole-house cut" \
    || bad "$c IS in the whole-house cut, and it must never be"
done
n=$(psql "SELECT count(*) FROM ips_in_scope('dinner') WHERE ip='192.168.60.242'")
[ "${n:-0}" = 1 ] && ok "a shared family device is caught by the dinner scope" \
  || bad "a shared family device is NOT caught by dinner, so the family TV stays on"
psql "UPDATE devices SET caught_by_dinner=false WHERE mac::text='fe:ed:5a:00:00:02'" >/dev/null
n=$(psql "SELECT count(*) FROM ips_in_scope('dinner') WHERE ip='192.168.60.242'")
[ "${n:-1}" = 0 ] && ok "unticking a shared device takes it out of the dinner scope" \
  || bad "a shared device unticked for dinner is still caught by it"
psql "DELETE FROM devices WHERE mac::text LIKE 'fe:ed:5a:%'" >/dev/null

n=$(psql "SELECT count(*) FROM board_settings WHERE enabled")
[ "${n:-0}" = 0 ] && ok "the achievement board is off by default" \
  || bad "the achievement board is ON on a fresh install, and that was meant to need a parent's yes"

# Community learning packages (config/db/schema-packages.sql). The two
# functions are the ONLY way a package gets in or out, so a fresh install that
# is missing them can list packages and never install one, which is the sort of
# half-working that is worse than a clear failure.
for fn in install_quiz_package remove_quiz_package; do
  [ "$(psql "SELECT count(*)>0 FROM pg_proc WHERE proname='$fn'")" = t ] \
    && ok "$fn() exists" || bad "$fn() is missing, so packages cannot be installed"
done
# SECURITY DEFINER is what lets the least-privilege kids_agent role install a
# package without being handed write access to every quiz bank in the house.
[ "$(psql "SELECT prosecdef FROM pg_proc WHERE proname='install_quiz_package'")" = t ] \
  && ok "install_quiz_package() is SECURITY DEFINER" \
  || bad "install_quiz_package() is not SECURITY DEFINER, so kids_agent would need write access to the quiz tables"
# The licence allowlist is a real constraint, not a comment. A package with a
# licence that does not let a household keep and change it is not shareable.
out=$(psql "INSERT INTO quiz_banks(id,title) VALUES('lic-test','Licence test');
            INSERT INTO quiz_packages(bank_id,author,licence) VALUES('lic-test','x','All rights reserved');")
case "$out" in
  *quiz_packages_licence_ck*) ok "an unshareable licence is refused" ;;
  *) bad "quiz_packages accepted the licence 'All rights reserved'" ;;
esac
psql "DELETE FROM quiz_banks WHERE id='lic-test';" >/dev/null

# The slow lane (config/db/schema-slow.sql). Three things have to be true on a
# fresh install, and the last two are the ones that matter: the feature exists,
# it changes nothing until a household asks for it, and it can never reach a
# device that is not somebody's personal kit.
[ "$(psql "SELECT count(*)>0 FROM information_schema.columns
            WHERE table_name='category_state' AND column_name='speed'")" = t ] \
  && ok "category_state carries the third state (speed)" \
  || bad "category_state has no speed column, so the slow lane has nowhere to live"
[ "$(psql "SELECT to_regclass('public.slow_lane_ips') IS NOT NULL")" = t ] \
  && ok "slow_lane_ips exists, so the gateway has something to reconcile" \
  || bad "slow_lane_ips is missing"
n=$(psql "SELECT count(*) FROM category_state WHERE speed='slow'")
[ "${n:-0}" = 0 ] && ok "a fresh install throttles nobody" \
  || bad "a fresh install has ${n:-0} category in the slow lane, and a throttle nobody asked for is somebody's evening"
[ "$(psql "SELECT on_timeout FROM slow_settings")" = cut ] \
  && ok "running out of time still CUTS by default, as it always has" \
  || bad "the out-of-time behaviour changed without a household choosing it"
[ "$(psql "SELECT rate_kbit FROM slow_settings")" = 256 ] \
  && ok "the slow lane defaults to 256 kbit/s" \
  || bad "the slow lane default is not 256 kbit/s"
# THE IRON RULE. slow_lane_ips must never be able to name a camera, a smart
# lock or the access point. Proven, not asserted: put a non-personal device in
# the slow lane by hand and check the view refuses to return it.
psql "INSERT INTO children(name,kind,policy_tier,active) VALUES('slowtest','child','standard',true)
      ON CONFLICT (name) DO NOTHING" >/dev/null
cid=$(psql "SELECT id FROM children WHERE name='slowtest'")
psql "INSERT INTO devices(mac,label,child_id,category,is_active,reserved_ip)
      VALUES('02:00:00:00:00:01','a camera',$cid,'iot',true,'192.168.60.201')" >/dev/null
psql "INSERT INTO devices(mac,label,child_id,category,is_active,reserved_ip)
      VALUES('02:00:00:00:00:02','a phone',$cid,'personal',true,'192.168.60.202')" >/dev/null
psql "INSERT INTO category_state(child_id,category,blocked,speed,set_by)
      VALUES($cid,'video',false,'slow','schema-test')" >/dev/null
[ "$(psql "SELECT count(*) FROM slow_lane_ips WHERE ip='192.168.60.201'")" = 0 ] \
  && ok "an IoT device can NEVER be throttled, even when its owner is" \
  || bad "slow_lane_ips returned a non-personal device; the iron rule is broken"
[ "$(psql "SELECT count(*) FROM slow_lane_ips WHERE ip='192.168.60.202'")" = 1 ] \
  && ok "and the child's own phone is in the slow lane, so the view does work" \
  || bad "slow_lane_ips did not return the personal device, so nothing would be throttled"
psql "DELETE FROM children WHERE name='slowtest'" >/dev/null

# Notifications (schema-notify.sql). Two rules a fresh install has to arrive
# with, because getting either wrong is how a parental controls product starts
# leaking. test/notify-test.sh proves the behaviour; these prove the defaults.
n=$(psql "SELECT count(*) FROM notify_routes")
[ "${n:-0}" = 0 ] && ok "a fresh install has no notification routes, so nothing leaves the house" \
  || bad "a fresh install ships ${n:-0} notification route(s), and nobody asked for that"
# The wording rows are the safety mechanism: the sensitive categories may name
# no child and quote no detail, so nothing private can reach a lock screen.
for c in self-harm tor darknet drugs extreme proxy-vpn; do
  [ "$(psql "SELECT count(*) FROM notify_wording WHERE category='$c' AND NOT name_ok AND NOT detail_ok")" = 1 ] \
    && ok "the '$c' notification names no child and quotes no site" \
    || bad "the '$c' notification could put a child's name or a site on a lock screen"
done
# The unworded case must fail towards saying less, never towards guessing that
# a new alert type is harmless enough to quote.
[ "$(psql "SELECT count(*) FROM notify_wording WHERE category='@fallback' AND NOT name_ok AND NOT detail_ok")" = 1 ] \
  && ok "an alert category nobody has worded yet says the least it can" \
  || bad "the fallback notification wording is missing or would quote an alert it knows nothing about"

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
