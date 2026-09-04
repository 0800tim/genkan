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
# The routes the dashboard actually serves. Two of these used to be wrong
# (/now and /learn, which are /live and /earn), and because a 404 carries no
# inline script the check passed on them for weeks. See the status check below.
PAGES=(/ /live /week /trends /analytics /earn /devices /family /settings /notify /system)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0
for pg in "${PAGES[@]}"; do
  # The STATUS first. A page that 500s or 404s contains no inline script, so
  # checking only that its scripts parse passed it silently: that is exactly
  # how a dashboard broken by a missing column stayed green here while the
  # parent looking at it saw an error (2026-09-04).
  code=$(curl -s --max-time 15 -o "$TMP/page.html" -w '%{http_code}' "$BASE$pg")
  if [ "$code" != 200 ]; then
    printf '  FAIL  %-11s answered %s: %s\n' "$pg" "$code" "$(head -c 120 "$TMP/page.html" | tr -d '\n')"
    fail=1; continue
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
  [ "$bad" = 0 ] && printf '  ok    %-11s 200, %s inline script(s) parse\n' "$pg" "$n" || fail=1
done
[ "$fail" = 0 ] && echo "every page's scripts parse" || { echo "a page is serving JavaScript the browser cannot run"; exit 1; }
