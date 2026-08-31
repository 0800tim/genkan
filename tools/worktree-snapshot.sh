#!/usr/bin/env bash
# genkan:summary=Snapshot uncommitted work so a bad git command cannot destroy it.
#
# Written after `git checkout dashboard/portal.mjs` discarded an agent's
# uncommitted work and there was nothing to recover from. Good intentions are
# not a safeguard. This is.
#
# Every run commits the entire working tree, tracked and untracked, to a
# SEPARATE ref that never appears in the branch history and never affects a
# push. Recovering is then an ordinary git operation:
#
#   tools/worktree-snapshot.sh list           what snapshots exist
#   tools/worktree-snapshot.sh show <ref>     what was in one
#   tools/worktree-snapshot.sh restore <ref> <path>   put one file back
#
# It is deliberately dumb and deliberately cheap: git already deduplicates
# blobs, so snapshotting an unchanged tree costs almost nothing.
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
cd "$R"
REF=refs/genkan/snapshots
KEEP="${SNAPSHOT_KEEP:-200}"

case "${1:-save}" in
  save)
    # An index of our own, so this never disturbs whatever is staged for a
    # real commit. That matters: a snapshot must never surprise the person
    # or agent working in the tree.
    export GIT_INDEX_FILE="$R/.git/genkan-snapshot-index"
    rm -f "$GIT_INDEX_FILE"
    git add -A --force . 2>/dev/null || true
    tree=$(git write-tree)
    parent=$(git rev-parse -q --verify "$REF" 2>/dev/null || true)
    # Nothing changed since the last one: do not pile up identical commits.
    if [ -n "$parent" ] && [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
      rm -f "$GIT_INDEX_FILE"; exit 0
    fi
    msg="worktree $(date -Is) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)"
    commit=$(if [ -n "$parent" ]; then git commit-tree "$tree" -p "$parent" -m "$msg";
             else git commit-tree "$tree" -m "$msg"; fi)
    git update-ref "$REF" "$commit"
    rm -f "$GIT_INDEX_FILE"
    ;;
  list)
    git log --format='  %h  %ad  %s' --date=format:'%d %b %H:%M' "$REF" 2>/dev/null | head -"${2:-20}" \
      || echo "  no snapshots yet"
    ;;
  show)
    git show --stat "${2:?which snapshot}" ;;
  restore)
    ref="${2:?which snapshot}"; path="${3:?which file}"
    git show "$ref:$path" > "$path"
    echo "restored $path from $ref"
    ;;
  *) echo "usage: worktree-snapshot.sh [save|list|show <ref>|restore <ref> <path>]"; exit 1;;
esac
