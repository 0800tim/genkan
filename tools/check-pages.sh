#!/usr/bin/env bash
# genkan:summary=Fetch every dashboard page and refuse any inline script that does not parse.
#
#   tools/check-pages.sh [base-url]     default http://127.0.0.1:9275 (the demo dashboard)
#
# Why this exists: the dashboard's page scripts are built inside JavaScript
# template literals on the server. A backslash escape written once instead of
# twice (\n for \\n) turns into a real newline in the served page, a
# single-quoted string breaks across lines, and every function declared after
# that point in the script silently does not exist. On 2026-09-02 that was the
# devices page: the Assign button did nothing, with one console line to show
# for it, since the day the house-off confirm was added. The browser is the
# only thing that ever parsed those scripts, so nothing in test/ could see it.
# This does what the browser does, with node, for every page, in a second.
set -uo pipefail
BASE="${1:-http://127.0.0.1:9275}"
PAGES=(/ /now /week /trends /analytics /learn /devices /family /system)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0
for pg in "${PAGES[@]}"; do
  if ! curl -s --max-time 15 "$BASE$pg" -o "$TMP/page.html"; then
    printf '  FAIL  %-10s did not answer\n' "$pg"; fail=1; continue
  fi
  n=$(python3 - "$TMP/page.html" "$TMP" <<'PY'
import re,sys
html=open(sys.argv[1],errors='replace').read()
scripts=re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',html,re.S)
for i,s in enumerate(scripts): open(f'{sys.argv[2]}/s{i}.js','w').write(s)
print(len(scripts))
PY
)
  bad=0
  for f in "$TMP"/s*.js; do
    [ -e "$f" ] || continue
    if ! err=$(node --check "$f" 2>&1); then
      bad=1; printf '  FAIL  %-10s %s\n' "$pg" "$(printf '%s' "$err" | grep -m1 'Error' | cut -c1-90)"
    fi
    rm -f "$f"
  done
  [ "$bad" = 0 ] && printf '  ok    %-10s %s inline script(s) parse\n' "$pg" "$n" || fail=1
done
[ "$fail" = 0 ] && echo "every page's scripts parse" || { echo "a page is serving JavaScript the browser cannot run"; exit 1; }
