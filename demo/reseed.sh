#!/usr/bin/env bash
# Rebuild the demo database from scratch: the real schema files, then the
# made-up household. Safe to run at any time, and run nightly by
# genkan-demo-reseed.timer so the six weeks of history never go stale and
# anything a visitor changed on the demo is put back.
#
# It only ever talks to the demo container. There is no path from here to the
# household's own database: the connection is `docker compose exec` into
# genkan-demo-db, which has its own volume on its own network.
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose -f compose.yaml)
# SUPERUSER PATH, deliberately, and safely. This script drops and recreates the
# public schema and reloads every schema file, which is owner work that the
# household's restricted kids_agent role cannot and must not be able to do. It
# is safe because the target is genkan-demo-db: a throwaway container, on its
# own network, with its own volume, holding a made-up family. There is no route
# from here to the household database, and no household value is ever passed in.
PSQL=("${DC[@]}" exec -T demo-db psql -v ON_ERROR_STOP=1 -U postgres -d genkan_demo)

# The order is load bearing: it is config/db/load.sh's list, and must stay
# equal to it. The demo portal 500s when a table the code reads is missing
# (quiz_banks, once), which is what a drifted copy of this list looks like.
FILES=(schema schema-categories schema-time schema-safety
       schema-earn schema-people schema-devices schema-flags
       schema-services schema-voice schema-goals schema-policies
       schema-tasks schema-quizresults schema-quizbanks schema-packages
       schema-badges seed schema-presence schema-appliance
       schema-roles schema-claim schema-shared schema-learn
       schema-learn-intl schema-schedule schema-slow schema-notify
       schema-release schema-retention schema-tor schema-settings schema-summaries)

echo "==> waiting for the demo database"
for _ in $(seq 1 60); do
  if "${DC[@]}" exec -T demo-db pg_isready -U postgres -d genkan_demo >/dev/null 2>&1; then break; fi
  sleep 2
done

# The schema files end in GRANT ... TO kids_app, so the role has to exist first.
"${PSQL[@]}" -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_app') THEN CREATE ROLE kids_app LOGIN PASSWORD 'demo'; END IF; END \$\$;"
"${PSQL[@]}" -q -c "ALTER DATABASE genkan_demo SET timezone = 'Pacific/Auckland';"

# Start from nothing every time. The schema files are idempotent individually,
# but the whole SET is not re-runnable on a database that already has them:
# schema-people.sql does CREATE OR REPLACE VIEW people, and schema-roles.sql has
# since widened that view, so the second pass fails with "cannot drop columns
# from view". A household box loads them once and never hits it. The demo
# reloads them nightly, so it wipes first. Nothing of value lives here.
echo "==> empty database"
"${PSQL[@]}" -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
  GRANT ALL ON SCHEMA public TO postgres; GRANT USAGE, CREATE ON SCHEMA public TO kids_app;"

echo "==> schema"
for f in "${FILES[@]}"; do
  printf '    %s\n' "$f.sql"
  "${PSQL[@]}" -q < "../config/db/$f.sql"
done

echo "==> demo household"
"${PSQL[@]}" < seed.sql
# The learning history (rounds, study visits, badges, the out-of-time child)
# sits in its own file so the family and its learning can change separately.
echo "==> demo learning history"
"${PSQL[@]}" < seed-learn.sql

echo "==> done"
