#!/usr/bin/env bash
# hearth:summary=Load every schema file into a database, in an order that works.
#
# The order matters and is not alphabetical, because several files build views
# over tables and columns that other files add. A documented list drifts: the
# one in docs/DATABASE.md was wrong for months and a fresh install failed on
# the first two files with "relation children does not exist". A script does
# not drift, because it is the thing that runs.
#
#   config/db/load.sh <database> [container]
#
# The files are individually idempotent, but the SET is not: schema-people.sql
# does CREATE OR REPLACE VIEW people, and schema-roles.sql later widens it, so
# re-running the set over an existing database can leave a narrower view than
# the last file expected. Load into an empty database, or drop the schema
# first, which is what demo/reseed.sh does.
set -euo pipefail
DB="${1:?usage: load.sh <database> [postgres-container]}"
PG="${2:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Dependency order, verified end to end by test/schema-test.sh.
# seed.sql is not optional. It carries the three child filter levels, without
# which a parent cannot give a child a budget at all, and the always_allow
# safety-net rows, without which a cut-off child cannot reach a help line. It
# has to follow schema-safety.sql, which creates the table it fills.
FILES=(schema schema-categories schema-time schema-safety schema-earn
       schema-people schema-devices schema-flags schema-services
       schema-voice schema-goals schema-policies schema-tasks
       schema-quizresults seed schema-presence schema-appliance schema-roles
       schema-claim)

# The files end in GRANT ... TO kids_app, so the role has to exist first.
docker exec -i "$PG" psql -U postgres -d "$DB" -qc \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_app')
     THEN CREATE ROLE kids_app; END IF; END \$\$;" >/dev/null

fail=0
for f in "${FILES[@]}"; do
  err=$(docker exec -i "$PG" psql -U postgres -d "$DB" -q < "$HERE/$f.sql" 2>&1 | grep '^ERROR' | head -1 || true)
  if [ -n "$err" ]; then printf '  FAILED  %-26s %s\n' "$f.sql" "$err"; fail=1
  else printf '  loaded  %s\n' "$f.sql"; fi
done
[ "$fail" = 0 ] || { echo "schema load FAILED"; exit 1; }
echo "loaded ${#FILES[@]} schema files into $DB"
