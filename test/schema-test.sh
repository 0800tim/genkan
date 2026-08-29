#!/usr/bin/env bash
# hearth:summary=A fresh install must load. Proves the schema order on an empty database.
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
DB="hearth_schema_test_$$"
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
           earn_settings_effective child_badges quiz_study_visits board_settings; do
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
n=$(psql "SELECT count(*) FROM vendor_clouds")
[ "${n:-0}" -gt 10 ] && ok "smart-home vendor clouds are seeded ($n)" || bad "vendor_clouds has ${n:-0} rows"
# The comparison board is off until a parent turns it on: see the note at the
# top of schema-badges.sql for why. A fresh install must not wake a sibling
# rivalry nobody asked for.
n=$(psql "SELECT count(*) FROM board_settings WHERE enabled")
[ "${n:-0}" = 0 ] && ok "the achievement board is off by default" \
  || bad "the achievement board is ON on a fresh install, and that was meant to need a parent's yes"

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
