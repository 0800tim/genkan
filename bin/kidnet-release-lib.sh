# hearth:summary=Shared helpers for kidnet-upgrade and kidnet-rollback. Not a command.
#
# Sourced, never executed. It holds the handful of things both the upgrade and
# the rollback need to agree on exactly: where the repo is, what version this
# is, where snapshots live, and how a change gets written to the release log.
# They have to agree, because a rollback has to be able to undo an upgrade it
# did not run itself, possibly weeks later, possibly after a reboot.

# Where Hearth's code lives. Three answers, in order, because these scripts
# run from two places: out of the repo, and out of /usr/local/bin where
# deploy.sh installs them. From /usr/local/bin the parent directory is
# /usr/local, which is not a Hearth checkout, so guessing it would be wrong in
# exactly the situation that matters most.
#   1. HEARTH_ROOT, if somebody set it. This is also how test/release-test.sh
#      drives the whole release path against a throwaway clone without going
#      anywhere near a household's live gateway.
#   2. The directory above this file, when that looks like a checkout.
#   3. What deploy.sh recorded in /etc/kids-network/hearth-root.
hearth_find_root(){
  local d
  d="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
  if [ -n "$d" ] && [ -f "$d/VERSION" ] && [ -d "$d/config/db" ]; then echo "$d"; return 0; fi
  if [ -f /etc/kids-network/hearth-root ]; then
    d="$(tr -d ' \t\r\n' < /etc/kids-network/hearth-root)"
    if [ -n "$d" ] && [ -f "$d/VERSION" ]; then echo "$d"; return 0; fi
  fi
  return 1
}
: "${HEARTH_ROOT:=$(hearth_find_root || echo "")}"
# Where snapshots, the lock and the in-progress marker live. Deliberately NOT
# inside the repo: a rollback checks the repo out to an older commit, and
# state that describes how to undo that must not move when it happens.
: "${HEARTH_STATE_DIR:=/var/lib/hearth/releases}"
: "${HEARTH_HEALTH_FILE:=/var/lib/hearth/health.json}"
: "${PG_CONTAINER:=postgres}"
: "${HEARTH_DB:=kids_network}"
: "${HEARTH_DB_ROLE:=kids_agent}"
# What actually puts a version live. deploy.sh is idempotent by design, so
# running it is the whole of "apply", forwards or backwards.
: "${HEARTH_APPLY_CMD:=}"
# How many old snapshots to keep. Each is a compressed pg_dump, so a year of
# monthly upgrades is a few hundred megabytes at most.
: "${HEARTH_KEEP_SNAPSHOTS:=10}"
# How long to give the box to come back before judging it broken. Containers
# take a moment after a deploy, and calling an upgrade a failure because the
# gateway was still starting would roll back a version that was fine.
: "${HEARTH_HEALTH_WAIT:=150}"

R="$HEARTH_ROOT"
git_ok(){ command -v git >/dev/null 2>&1 && git -C "$R" rev-parse --git-dir >/dev/null 2>&1; }
g(){ git -C "$R" "$@"; }

# The version string in the VERSION file. One line, nothing else in it, so
# that reading it needs no tooling: `cat VERSION` is the whole contract.
hearth_version(){
  if [ -f "$R/VERSION" ]; then tr -d ' \t\r\n' < "$R/VERSION"; else echo "unknown"; fi
}
hearth_commit(){ git_ok && g rev-parse HEAD 2>/dev/null || echo ""; }
hearth_short(){  git_ok && g rev-parse --short HEAD 2>/dev/null || echo ""; }

# One line a parent can read. Says the version, and says plainly when the box
# is running something that is not a release, because "2026.09.0" on its own
# would be a lie on a box carrying six uncommitted experiments.
hearth_version_line(){
  local v tag n note dirty
  v="$(hearth_version)"; tag="v$v"
  if ! git_ok; then echo "Hearth $v"; return; fi
  note=""
  if ! g rev-parse -q --verify "refs/tags/$tag^{commit}" >/dev/null 2>&1; then
    note="not released yet"
  elif [ "$(g rev-parse "refs/tags/$tag^{commit}")" != "$(g rev-parse HEAD)" ]; then
    n="$(g rev-list --count "refs/tags/$tag..HEAD" 2>/dev/null || echo some)"
    note="$n change(s) since the release"
  fi
  if [ -n "$(g status --porcelain 2>/dev/null)" ]; then
    dirty="edited on this box"
    note="${note:+$note, }$dirty"
  fi
  echo "Hearth $v${note:+ ($note)}"
}

# The release log. EVERY call here is best effort and swallows its own errors.
# A database that is down must never stop an upgrade or, far more importantly,
# a rollback: the database being down is one of the reasons somebody would be
# rolling back in the first place.
release_record(){ # action from_version from_commit to_version to_commit snapshot ok note
  local a="$1" fv="$2" fc="$3" tv="$4" tc="$5" sn="$6" ok="$7" note="$8"
  docker exec -i "$PG_CONTAINER" psql -U "$HEARTH_DB_ROLE" -d "$HEARTH_DB" -qtAc \
    "INSERT INTO release_history(action,from_version,from_commit,to_version,to_commit,snapshot,ok,note)
     VALUES('$(sqesc "$a")','$(sqesc "$fv")','$(sqesc "$fc")','$(sqesc "$tv")','$(sqesc "$tc")',
            $( [ -n "$sn" ] && echo "'$(sqesc "$sn")'" || echo NULL ),$ok,'$(sqesc "$note")')" \
    >/dev/null 2>&1 || true
}

# Single quotes are the only thing that can break out of the literals above,
# and every value written here comes from git or from this box's own files
# rather than from a person, so doubling them is enough and is the same gate
# bin/kidnet uses.
sqesc(){ printf '%s' "$1" | sed "s/'/''/g"; }

# --- snapshots -------------------------------------------------------------
# A snapshot is one directory. Everything needed to put this box back the way
# it was is in it, in formats that can be read by hand with no Hearth tooling
# at all, because the day you need it is the day the tooling might be the
# thing that is broken.
snapshot_dir(){ printf '%s/%s' "$HEARTH_STATE_DIR" "$1"; }
snapshot_list(){ ls -1 "$HEARTH_STATE_DIR" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r; }
snapshot_field(){ # id field
  local f; f="$(snapshot_dir "$1")/manifest.env"
  [ -f "$f" ] || return 1
  sed -n "s/^$2=//p" "$f" | head -1
}
