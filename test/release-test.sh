#!/usr/bin/env bash
# hearth:summary=Proves the upgrade and rollback path, on a throwaway clone and a throwaway database.
#
# The whole point of bin/kidnet-upgrade is that it must never leave a
# household without internet. That claim is worth nothing untested, and it
# cannot be tested on the household's own gateway, because the test IS the
# outage. So this builds a complete fake: a local clone of the repo with two
# invented releases in it, a throwaway Postgres database, and a fake apply
# step that does nothing. Then it upgrades, breaks the health check on
# purpose, and checks that the tooling put the old version back by itself.
#
#   sudo test/release-test.sh     all of it
#   test/release-test.sh          the read-only half; everything that applies a
#                                 version is skipped, because kidnet-upgrade
#                                 refuses to run without root and that refusal
#                                 is itself one of the things worth keeping.
#
# One honest caveat. The health check the fake upgrade runs is the real
# kidnet-health, and it looks at the real containers on this box, because
# there is no second gateway to point it at. So "the upgrade passed its health
# check" here means "the tooling ran the check and believed it", not "the
# clone is serving a household". The failure path is the one that is properly
# proved: it points the health check at containers that do not exist, which is
# indistinguishable from a genuinely broken upgrade.
#
# It NEVER touches: the repo you are sitting in, /var/lib/hearth, the
# kids_network database, any container, or deploy.sh. Every path is redirected
# with HEARTH_ROOT, HEARTH_STATE_DIR, HEARTH_DB and HEARTH_APPLY_CMD.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
TDB="hearth_release_test_$$"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hearth-release-test-XXXXXX")"
CLONE="$TMP/clone"
STATE="$TMP/state"

# Run under sudo the git operations happen as root against a tree owned by
# somebody else, which git refuses by default. This is a throwaway clone in a
# temp directory, so the refusal is noise rather than a safeguard.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; return 0; }
skip(){ printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
psql(){ docker exec -i "$PG" psql -U postgres -d "$TDB" -tAc "$1" 2>&1; }
cleanup(){
  docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $TDB;" >/dev/null 2>&1
  [ -d "$CLONE" ] && git -C "$CLONE" worktree prune >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT
command -v docker >/dev/null || { echo "MISSING REQUIRED TOOL: docker"; exit 1; }

echo
echo "A throwaway household, two invented releases, and an upgrade that breaks"
echo "  workspace $TMP"

# --- build the fake household ---------------------------------------------
git clone --quiet --local --no-hardlinks "$REPO" "$CLONE" 2>/dev/null || { echo "could not clone"; exit 1; }
git -C "$CLONE" config user.email test@example.invalid
git -C "$CLONE" config user.name  "release test"
# A clone only carries committed files, and what a release would actually be
# cut from is the working tree. So the working tree is copied over the clone.
# It also keeps this suite honest in a repo where several people are working:
# testing the last commit would mean testing something nobody is running.
# secrets.env and config.env are excluded on purpose. They hold this
# household's real values and have no business in a temp directory.
tar -C "$REPO" --exclude=./.git --exclude=node_modules --exclude=./secrets.env \
    --exclude=./config.env -cf - . 2>/dev/null | tar -C "$CLONE" -xf - 2>/dev/null
# Release one: whatever the repo says now.
printf '2026.09.0\n' > "$CLONE/VERSION"
git -C "$CLONE" add -A >/dev/null && git -C "$CLONE" commit -qm "release 2026.09.0" >/dev/null
git -C "$CLONE" tag v2026.09.0
V1="$(git -C "$CLONE" rev-parse HEAD)"
# Release two: a trivial, harmless change plus a version bump.
printf '2026.10.0\n' > "$CLONE/VERSION"
echo "# a change that arrived in 2026.10.0" >> "$CLONE/README.md"
git -C "$CLONE" add -A >/dev/null && git -C "$CLONE" commit -qm "release 2026.10.0" >/dev/null
git -C "$CLONE" tag v2026.10.0
V2="$(git -C "$CLONE" rev-parse HEAD)"
git -C "$CLONE" checkout -q --detach v2026.09.0

# A fake apply step. deploy.sh must never run from a test: it builds images,
# writes /usr/local/bin and restarts a real household's containers.
cat > "$TMP/fake-apply.sh" <<'EOS'
#!/usr/bin/env bash
echo "   (fake apply: pretending to run deploy.sh)"
echo "applied $(cat VERSION)" >> "$HEARTH_STATE_DIR/apply.log"
EOS
chmod +x "$TMP/fake-apply.sh"

# A throwaway database with just the release log in it, so the release history
# and the backup/restore path are exercised for real without going near
# kids_network.
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $TDB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
docker exec -i "$PG" psql -U postgres -d "$TDB" -q \
  -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_app') THEN CREATE ROLE kids_app; END IF; END \$\$;" >/dev/null 2>&1
docker exec -i "$PG" psql -U postgres -d "$TDB" -q < "$REPO/config/db/schema-release.sql" >/dev/null 2>&1 \
  && ok "config/db/schema-release.sql loads into an empty database" \
  || bad "config/db/schema-release.sql does not load"
psql "CREATE TABLE marker(v text); INSERT INTO marker VALUES ('before the upgrade');" >/dev/null 2>&1

# HEARTH_HEALTH_FILE matters as much as the rest: without it the health checks
# this test runs would overwrite the real box's cached answer in
# /var/lib/hearth, and the dashboard would show a made-up household's health.
export HEARTH_ROOT="$CLONE" HEARTH_STATE_DIR="$STATE" HEARTH_DB="$TDB" \
       PG_CONTAINER="$PG" HEARTH_APPLY_CMD="bash $TMP/fake-apply.sh" \
       HEARTH_KEEP_SNAPSHOTS=3 HEARTH_HEALTH_FILE="$TMP/health.json" \
       HEARTH_HEALTH_WAIT=0
UP="$CLONE/bin/kidnet-upgrade"; RB="$CLONE/bin/kidnet-rollback"

# --- what it says before it does anything ---------------------------------
out="$("$UP" check 2>&1)"
printf '%s' "$out" | grep -q "Hearth 2026.10.0" \
  && ok "check finds the newer release without changing anything" \
  || bad "check did not offer 2026.10.0" "$out"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V1" ] \
  && ok "check left the code exactly where it was" || bad "check moved the code"
[ ! -d "$STATE" ] && ok "check wrote no state at all" || bad "check created $STATE"

out="$("$UP" apply --dry-run --yes 2>&1)"
printf '%s' "$out" | grep -q "would run: git checkout" \
  && ok "a dry run prints the switchover instead of doing it" || bad "dry run did not describe the switchover" "$out"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V1" ] \
  && ok "a dry run changed nothing" || bad "the dry run moved the code"

# --- refusing to upgrade into a broken state ------------------------------
# A ruleset that does not parse must stop the upgrade dead, BEFORE anything is
# switched over. This is the check that protects a household from a bad
# release, so it is the one worth breaking on purpose.
if [ "$(id -u)" = 0 ]; then
  git -C "$CLONE" checkout -q --detach v2026.10.0
  echo "this is not nftables syntax {{{" >> "$CLONE/config/nftables/kids.nft"
  git -C "$CLONE" commit -qam "a release with a broken firewall" >/dev/null
  git -C "$CLONE" tag -f v2026.10.0 >/dev/null 2>&1
  BROKEN="$(git -C "$CLONE" rev-parse HEAD)"
  git -C "$CLONE" checkout -q --detach "$V1"
  out="$("$UP" apply --yes 2>&1)"; rc=$?
  [ "$rc" != 0 ] && printf '%s' "$out" | grep -qi "REFUSING TO UPGRADE" \
    && ok "a release with a firewall ruleset that does not parse is refused" \
    || bad "a broken ruleset was NOT refused (rc=$rc)" "$(printf '%s' "$out" | tail -3)"
  [ "$(git -C "$CLONE" rev-parse HEAD)" = "$V1" ] \
    && ok "after refusing, the household is still on the old version" || bad "the refusal still moved the code"
  # The lock file is created before the checks run and is meant to be there.
  # What must NOT exist is a snapshot, a database dump or an in-progress marker.
  [ -z "$(ls -1 "$STATE" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$')" ] && [ ! -f "$STATE/in-progress" ] \
    && ok "after refusing, no snapshot and no database dump were made" || bad "a refused upgrade left state behind"
  # Put the good release back for the rest of the run.
  git -C "$CLONE" tag -f v2026.10.0 "$V2" >/dev/null 2>&1
else
  skip "the broken-ruleset refusal (needs sudo: nft -c wants root)"
  skip "the state left behind by a refusal (needs sudo)"
  skip "the code left alone by a refusal (needs sudo)"
fi

# Everything past here applies a version, and kidnet-upgrade refuses to do
# that without root. That refusal is deliberate and is not worth working
# around, so the rest of the suite is skipped rather than failed.
if [ "$(id -u)" != 0 ]; then
  for t in "a good release installs and passes the health check" \
           "the snapshot, the database backup and the copied undo tool" \
           "running the same upgrade twice" \
           "the rollback path, with and without the database" \
           "an upgrade that breaks the household rolling itself back" \
           "picking up an interrupted run" \
           "refusing to overwrite uncommitted work" \
           "pruning old snapshots"; do
    skip "$t (needs sudo: applying a version does)"
  done
  echo
  echo "passed $pass, failed $fail   (the half that applies a version was skipped: run with sudo)"
  [ "$fail" = 0 ]
  exit
fi

# --- a good upgrade -------------------------------------------------------
out="$("$UP" apply --yes 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "a good release installs and passes the health check" \
  || bad "the good upgrade did not finish cleanly (rc=$rc)" "$(printf '%s' "$out" | tail -5)"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V2" ] \
  && ok "the code is now on the new release" || bad "the code did not move to the new release"
[ "$(cat "$CLONE/VERSION")" = "2026.10.0" ] \
  && ok "the version file says what is running" || bad "VERSION is wrong after the upgrade"
SNAPID="$(ls -1 "$STATE" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | head -1)"
[ -n "$SNAPID" ] && ok "a snapshot was taken ($SNAPID)" || bad "no snapshot was taken"
[ -s "$STATE/$SNAPID/db.sql.gz" ] && ok "the snapshot holds a real database backup" || bad "the database backup is missing or empty"
grep -q "^from_commit=$V1" "$STATE/$SNAPID/manifest.env" \
  && ok "the snapshot records the commit to come back to" || bad "the manifest does not record from_commit"
[ -x "$STATE/$SNAPID/kidnet-rollback" ] \
  && ok "the undo tool was copied into the snapshot before the switchover" || bad "the snapshot has no copy of kidnet-rollback"
[ ! -f "$STATE/in-progress" ] && ok "the in-progress marker was cleared" || bad "an in-progress marker was left behind"
[ "$(psql "SELECT count(*) FROM release_history WHERE action='upgrade' AND ok")" = 1 ] \
  && ok "the upgrade was written to the release log" || bad "nothing was written to release_history"

# --- safe to run twice ----------------------------------------------------
out="$("$UP" apply --yes 2>&1)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "already running" \
  && ok "running the same upgrade again says so and does nothing" \
  || bad "a second identical upgrade was not a no-op (rc=$rc)" "$(printf '%s' "$out" | tail -3)"
n="$(ls -1 "$STATE" | grep -cE '^[0-9]{8}-[0-9]{6}$')"
[ "$n" = 1 ] && ok "the second run made no second snapshot" || bad "a no-op upgrade still made a snapshot"

# --- rollback, deliberately ------------------------------------------------
out="$("$RB" list 2>&1)"
printf '%s' "$out" | grep -q "$SNAPID" && ok "rollback lists what it can go back to" || bad "rollback list is empty" "$out"
printf '%s' "$out" | grep -q "goes back to Hearth 2026.09.0" \
  && ok "the list says which version each point goes back to" || bad "the list does not name the version"
out="$("$RB" to previous --dry-run 2>&1)"
printf '%s' "$out" | grep -q "would run" && ok "a rollback dry run describes the steps" || bad "rollback --dry-run did nothing recognisable"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V2" ] && ok "the rollback dry run changed nothing" || bad "the rollback dry run moved the code"
printf '%s' "$out" | grep -q "database will be LEFT ALONE" \
  && ok "a rollback says plainly that the database is not being touched" || bad "the rollback did not say what happens to the database"

out="$("$RB" to previous --yes 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "a deliberate rollback completes" || bad "rollback failed (rc=$rc)" "$(printf '%s' "$out" | tail -5)"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V1" ] && ok "the code went back to the old release" || bad "the code did not go back"
[ "$(psql "SELECT v FROM marker")" = "before the upgrade" ] \
  && ok "a code-only rollback left the database alone" || bad "the database changed during a code-only rollback"
[ "$(psql "SELECT count(*) FROM release_history WHERE action='rollback'")" = 1 ] \
  && ok "the rollback was written to the release log" || bad "the rollback was not logged"

# --- restoring the database ------------------------------------------------
psql "UPDATE marker SET v='after the upgrade'" >/dev/null
out="$("$RB" to "$SNAPID" --with-database --yes 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "a rollback with --with-database completes" || bad "the database rollback failed (rc=$rc)" "$(printf '%s' "$out" | tail -5)"
[ "$(psql "SELECT v FROM marker")" = "before the upgrade" ] \
  && ok "the database really was put back to the snapshot" || bad "the database was not restored"
ls "$STATE/$SNAPID"/pre-restore-*.sql.gz >/dev/null 2>&1 \
  && ok "the database that was replaced was copied first" || bad "no pre-restore copy was kept"

# --- an upgrade that breaks the household ---------------------------------
# The one that matters. The health check is pointed at containers that do not
# exist, which is exactly what a broken upgrade looks like from here, and the
# tooling has to notice and undo itself with nobody watching.
git -C "$CLONE" checkout -q --detach "$V1"
rm -f "$STATE/in-progress"
out="$(GW_CONTAINER=hearth-does-not-exist ADGUARD_CONTAINER=hearth-does-not-exist \
       PORTAL_CONTAINER=hearth-does-not-exist "$UP" apply --yes --wait 0 2>&1)"; rc=$?
[ "$rc" != 0 ] && ok "an upgrade that breaks the household exits non-zero" || bad "a broken upgrade reported success"
printf '%s' "$out" | grep -q "Putting Hearth 2026.09.0 back" \
  && ok "it rolled itself back without being asked" || bad "no automatic rollback happened" "$(printf '%s' "$out" | tail -5)"
[ "$(git -C "$CLONE" rev-parse HEAD)" = "$V1" ] \
  && ok "the household is back on the version that worked" || bad "the box was left on the broken version"
[ ! -f "$STATE/in-progress" ] && ok "the in-progress marker was cleared after the rollback" || bad "an in-progress marker survived the rollback"
[ "$(psql "SELECT count(*) FROM release_history WHERE action='upgrade' AND NOT ok")" -ge 1 ] \
  && ok "the failed upgrade is in the release log, marked failed" || bad "the failed upgrade was not logged"

# --- interrupted half way --------------------------------------------------
# A marker left behind by a run that was killed. The next run must not start a
# fresh upgrade on top of it: it has to finish or undo the one already begun.
LAST="$(ls -1 "$STATE" | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | head -1)"
echo "$LAST" > "$STATE/in-progress"
echo "applying" > "$STATE/$LAST/phase"
out="$("$UP" apply --yes 2>&1)"; rc=$?
printf '%s' "$out" | grep -q "interrupted" \
  && ok "a run interrupted half way is picked up by the next run" || bad "an interrupted run was ignored" "$(printf '%s' "$out" | head -5)"
[ ! -f "$STATE/in-progress" ] && ok "finishing an interrupted run clears the marker" || bad "the marker survived"

# --- local edits -----------------------------------------------------------
git -C "$CLONE" checkout -q --detach "$V1"
echo "somebody was editing this by hand" >> "$CLONE/README.md"
out="$("$UP" apply --yes 2>&1)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "not committed" \
  && ok "an upgrade refuses to overwrite uncommitted work" || bad "uncommitted work was not protected (rc=$rc)"
git -C "$CLONE" rev-parse -q --verify refs/hearth/snapshots >/dev/null 2>&1 \
  && ok "the uncommitted work was snapshotted before refusing" || bad "no worktree snapshot was taken"
git -C "$CLONE" checkout -q -- README.md 2>/dev/null

# --- keeping the disk sane -------------------------------------------------
for i in 1 2 3 4 5; do mkdir -p "$STATE/2020010$i-000000"; printf 'id=2020010%s-000000\n' "$i" > "$STATE/2020010$i-000000/manifest.env"; done
git -C "$CLONE" checkout -q --detach "$V1"
"$UP" apply --yes >/dev/null 2>&1
n="$(ls -1 "$STATE" | grep -cE '^[0-9]{8}-[0-9]{6}$')"
[ "$n" -le 3 ] && ok "old snapshots are pruned to HEARTH_KEEP_SNAPSHOTS ($n kept)" \
  || bad "snapshots are not pruned ($n kept, expected 3)"

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
