#!/usr/bin/env bash
# genkan:summary=Publish the audited tree to the public repo, refusing if anything private leaks.
#
# The public repo is a SEPARATE git history from this working repo, because
# this one contains the household's real values in its past. This script
# exports the current tree, scans it, and only pushes if the scan is clean.
#
# It has already caught three leaks that careful editing missed, including a
# real child's name reintroduced by a README rewrite. Do not publish by hand.
set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
# --check scans and stops. Added because an agent ran this to verify its edits
# introduced no leak, not realising the scanner and the push are the same
# script, and published work it had been told not to push. Nothing leaked, the
# scan passed, but a tool whose only safe use is the one you meant is a badly
# designed tool. Checking must never publish.
DRY=0
case "${1:-}" in --check|-n|--dry-run) DRY=1; shift;; esac

# config.env first: it is where GENKAN_PUBLIC_DIR and GENKAN_AUTHOR live, and
# demanding the variable before reading the file only worked when a caller
# happened to have exported it.
. "$SRC/config.env" 2>/dev/null || true
PUB="${GENKAN_PUBLIC_DIR:?set GENKAN_PUBLIC_DIR in config.env to the public repo clone}"
[ -d "$PUB/.git" ] || { echo "no git repo at $PUB"; exit 1; }

if [ "$DRY" = 1 ]; then echo "CHECK ONLY: this will scan and stop, and publish nothing."
else echo "PUBLISHING: a clean scan will commit and PUSH to the public repo."
     echo "            Use --check to scan without publishing."; fi
echo "Exporting the tracked tree..."
find "$PUB" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$SRC" archive --format=tar HEAD | tar x -C "$PUB"

echo "Scanning for anything private..."
fail=0
scan(){ local pat="$1" label="$2"
  local hits; hits=$(grep -riIlP "$pat" "$PUB" --exclude-dir=.git 2>/dev/null | head -3)
  if [ -n "$hits" ]; then
    printf '  \033[31mLEAK\033[0m  %-22s %s\n' "$label" "$(echo "$hits" | sed "s|$PUB/||" | tr '\n' ' ')"; fail=1
  else printf '  ok    %-22s\n' "$label"; fi; }

# Household identifiers, from config.env so each family scans for their own.
[ -n "${KIDS_NIC_MAC:-}" ] && scan "$KIDS_NIC_MAC" "adapter MAC"
# Real-looking MACs only. Obvious fixtures (aa:bb:cc.., de:ad.., fe:ed..,
# 00:00:.., and the documentation example) are expected in tests and docs; a
# scanner that cries wolf on those is one people learn to ignore.
scan '(?!aa:bb:cc|de:ad:be|fe:ed:|cc:dd:ee|dd:ee:ff|00:00:00|02:|ce:11:)([0-9a-f]{2}:){5}[0-9a-f]{2}' "real-looking MAC"
# 100.64.0.x is the documentation-safe corner of the shared address space and
# is used deliberately as the example VPN address. Flag the rest of the range.
scan '100\.(6[5-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+|100\.64\.[1-9][0-9]*\.' "real VPN address"
scan 'password *[:=] *["'"'"'][^"'"'"']{6,}' "inline password"
scan '\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{20,}' "bcrypt hash"
scan 'gh[pousr]_[A-Za-z0-9]{20,}' "GitHub token"
scan 'BEGIN [A-Z ]*PRIVATE KEY' "private key"
# Real people. Names come from the database, so this stays correct as it changes.
# Two exclusions, both deliberate. Role labels ('guest-adult', 'guest-kid') are
# rows in `children` but they are not anybody, and matching them fired on every
# test that exercises roles. And the author's own name belongs in the LICENSE
# and the design notes: the project is published under its author's name.
# Everything else, every child and every named adult, is still a hard failure.
# From config.env (gitignored), not git's user.name, which on this machine is
# an agency account. Kept out of this file on purpose: hardcoding it would make
# the scanner flag itself, and a fork would scan for the wrong person.
AUTHOR="${GENKAN_AUTHOR:-}"
# The author's own row is excluded here because the placement check below
# covers it properly. Matched on any word of AUTHOR, since the household row
# is usually a first name while the LICENSE carries the full one.
NAMES=$(docker exec -i postgres psql -U "${GENKAN_DB_ROLE:-kids_agent}" -d kids_network -tAc \
  "SELECT string_agg(name,'|') FROM children
    WHERE name !~ '^guest-'
      AND NOT (lower(name) = ANY (string_to_array(lower('${AUTHOR:-__none__}'), ' ')))" 2>/dev/null)
if [ -z "${NAMES:-}" ]; then
  printf '  \033[31mLEAK\033[0m  %-22s %s\n' "real people's names" \
    "COULD NOT CHECK: the database did not answer. Refusing rather than guessing."; fail=1
else scan "\\b(${NAMES})\\b" "real people's names"; fi
# The author's name is allowed in the two files that are about authorship, and
# nowhere else, so a README rewrite cannot quietly reintroduce it as an example.
if [ -z "${AUTHOR:-}" ]; then
  printf '  \033[31mLEAK\033[0m  %-22s %s\n' "author name placement" \
    "COULD NOT CHECK: GENKAN_AUTHOR is not set in config.env."; fail=1
elif true; then
  hits=$(grep -riIlF "$AUTHOR" "$PUB" --exclude-dir=.git 2>/dev/null \
         | grep -vE '/(LICENSE|DECISIONS\.md|README\.md)$' | head -3)
  if [ -n "$hits" ]; then
    printf '  \033[31mLEAK\033[0m  %-22s %s\n' "author name outside LICENSE" \
      "$(echo "$hits" | sed "s|$PUB/||" | tr '\n' ' ')"; fail=1
  else printf '  ok    %-22s\n' "author name placement"; fi
fi
for f in secrets.env config.env; do
  [ -f "$PUB/$f" ] && { printf '  \033[31mLEAK\033[0m  %-22s\n' "$f"; fail=1; } || printf '  ok    %-22s absent\n' "$f"
done

if [ "$fail" != 0 ]; then
  echo; echo "REFUSING TO PUBLISH. Fix the above, then run again."; exit 1
fi
# grep -I skips binary files, so every check above is blind to an image. A
# screenshot of the dashboard is the single most likely way a child's name, a
# MAC and a private address leave this house at once, so binaries are refused
# outright rather than scanned. Add one deliberately and you add it here too.
BIN=$(find "$PUB" -path "$PUB/.git" -prune -o -type f -print 2>/dev/null \
      | while read -r f; do case "$(file -b --mime-type "$f" 2>/dev/null)" in
          text/*|inode/x-empty|application/json|application/xml|application/javascript|image/svg+xml) ;;
          *) echo "$f";; esac; done | head -5)
if [ -n "$BIN" ]; then
  printf '  \033[31mLEAK\033[0m  %-22s %s\n' "binary files present" \
    "$(echo "$BIN" | sed "s|$PUB/||" | tr '\n' ' ')"
  echo "        Binaries are never scanned for private data. Remove them or add an exception here."
  fail=1
else printf '  ok    %-22s\n' "no unscannable binaries"; fi

if [ "$DRY" = 1 ]; then
  echo; echo "Clean. Nothing was published: this was --check."
  echo "Run without --check to publish."
  exit 0
fi

echo; echo "Clean. Publishing..."
cd "$PUB"
git add -A
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git commit -q -m "${1:-Update from upstream working tree}"
git push -q origin main && echo "Published: $(git remote get-url origin)"
