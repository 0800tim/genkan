#!/usr/bin/env bash
# hearth:summary=Publish the audited tree to the public repo, refusing if anything private leaks.
#
# The public repo is a SEPARATE git history from this working repo, because
# this one contains the household's real values in its past. This script
# exports the current tree, scans it, and only pushes if the scan is clean.
#
# It has already caught three leaks that careful editing missed, including a
# real child's name reintroduced by a README rewrite. Do not publish by hand.
set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
PUB="${HEARTH_PUBLIC_DIR:?set HEARTH_PUBLIC_DIR to the public repo clone}"
[ -d "$PUB/.git" ] || { echo "no git repo at $PUB"; exit 1; }
. "$SRC/config.env" 2>/dev/null || true

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
scan '(?!aa:bb:cc|de:ad:be|fe:ed:|cc:dd:ee|dd:ee:ff|00:00:00|02:)([0-9a-f]{2}:){5}[0-9a-f]{2}' "real-looking MAC"
# 100.64.0.x is the documentation-safe corner of the shared address space and
# is used deliberately as the example VPN address. Flag the rest of the range.
scan '100\.(6[5-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+|100\.64\.[1-9][0-9]*\.' "real VPN address"
scan 'password *[:=] *["'"'"'][^"'"'"']{6,}' "inline password"
scan '\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{20,}' "bcrypt hash"
scan 'gh[pousr]_[A-Za-z0-9]{20,}' "GitHub token"
scan 'BEGIN [A-Z ]*PRIVATE KEY' "private key"
# Real people. Names come from the database, so this stays correct as it changes.
NAMES=$(docker exec -i postgres psql -U postgres -d kids_network -tAc \
  "SELECT string_agg(name,'|') FROM children" 2>/dev/null)
[ -n "${NAMES:-}" ] && scan "\\b(${NAMES})\\b" "real people's names"
for f in secrets.env config.env; do
  [ -f "$PUB/$f" ] && { printf '  \033[31mLEAK\033[0m  %-22s\n' "$f"; fail=1; } || printf '  ok    %-22s absent\n' "$f"
done

if [ "$fail" != 0 ]; then
  echo; echo "REFUSING TO PUBLISH. Fix the above, then run again."; exit 1
fi
echo; echo "Clean. Publishing..."
cd "$PUB"
git add -A
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git commit -q -m "${1:-Update from upstream working tree}"
git push -q origin main && echo "Published: $(git remote get-url origin)"
