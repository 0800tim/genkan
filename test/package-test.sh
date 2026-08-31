#!/usr/bin/env bash
# genkan:summary=A community package is hostile input. Proves the validator refuses it and the portal escapes it anyway.
#
# THE BUG THIS SUITE EXISTS TO PREVENT
#
# A learning package is written by a stranger and its text is rendered into a
# page that a CHILD opens, on a device inside the household's own network. A
# stored cross-site scripting hole arriving through a quiz in a pull request
# would be the worst bug this project could ship: it would run in the kid
# portal's origin, on the island, on a machine a parent believes is the safest
# thing on their network.
#
# So there are two independent defences and this suite proves both of them
# separately, which is the only way to know they are independent:
#
#   1. tools/validate-package.mjs refuses the payload on the way in, and
#      bin/genkan-pack refuses to install anything the validator refused.
#   2. If a payload somehow got in anyway, past the validator, past the CLI and
#      straight into the database, the portal STILL renders it inert, because
#      every field goes through esc() on the way out. Part 3 forces exactly
#      that and shows the rendered HTML.
#
# Needs docker and a running postgres container. Does NOT need root, and does
# not touch the real kids_network database: it builds a throwaway one, loads
# the schema into it, and drops it on the way out.
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
PG="${PG_CONTAINER:-postgres}"
DB="genkan_pack_test_$$"
WORK="$(mktemp -d)"
BASE="$R/portal/quizzes/community/paint-and-colour.json"

for t in docker node python3; do command -v "$t" >/dev/null || { echo "MISSING REQUIRED TOOL: $t"; exit 1; }; done
[ -f "$BASE" ] || { echo "MISSING the worked example package at $BASE"; exit 1; }

pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i "$PG" psql -U postgres -d "$DB" -tAc "$1" 2>&1; }
cleanup(){ docker exec -i "$PG" psql -U postgres -qc "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# The payloads. One file each, so a failure names the exact trick that got in.
# Every one starts from the worked example, which is a real, passing package,
# and changes exactly one thing. That is the honest test: a package that is
# wrong in one small place, not a file that is obviously rubbish.
# ---------------------------------------------------------------------------
python3 - "$BASE" "$WORK" <<'PY'
import json, sys, copy, os
base = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2]

# Named by what they try, because the report reads better than "case 7".
cases = {}

def case(name, fn):
    b = copy.deepcopy(base)
    b["id"] = name
    fn(b)
    cases[name] = b

def set_script_tag(b):
    b["questions"][0]["prompt"] = "Which colour is made from red and yellow?<script>alert(1)</script>"
case("xss-script-tag", set_script_tag)

def set_img_onerror(b):
    b["questions"][0]["choices"][1] = "<img src=x onerror=alert(document.cookie)>"
case("xss-img-onerror", set_img_onerror)

def set_entity(b):
    b["questions"][2]["explanation"] = "Green. &lt;script&gt;alert(1)&lt;/script&gt;"
case("xss-html-entity", set_entity)

def set_attr_breakout(b):
    # The portal puts a bank title inside an HTML attribute in more than one
    # place, so a closing quote is the classic way out of it.
    b["title"] = 'Paint" onmouseover="alert(1)'
case("xss-attribute-breakout", set_attr_breakout)

def set_js_url(b):
    b["package"]["read_first"]["links"][0] = {"label": "Read more", "url": "javascript:alert(1)"}
case("xss-javascript-url", set_js_url)

def set_offlist_url(b):
    b["package"]["read_first"]["links"][0] = {"label": "Read more", "url": "https://not-on-the-list.example.com/x"}
case("link-off-the-reading-list", set_offlist_url)

def set_data_url(b):
    b["questions"][3]["explanation"] = "Purple. See data:text/html;base64,PHNjcmlwdD4="
case("xss-data-url", set_data_url)

def set_invisible(b):
    # A right-to-left override inside a question is not a formatting choice.
    b["questions"][4]["prompt"] = "What does white do to a colour?‮​"
case("invisible-character", set_invisible)

def set_emoji_markup(b):
    b["emoji"] = "<b>"
case("markup-in-the-emoji", set_emoji_markup)

def set_long_explanation(b):
    # 500 characters. The database column stops at 400, so this would fail the
    # install with a constraint violation instead of a readable message.
    # Comfortably over the 800 the database will take. The cap was 400 until a
    # shipped NCEA biology explanation at 404 characters proved that too tight
    # to teach with, so this number tracks the constraint rather than a guess.
    b["questions"][5]["explanation"] = "x" * 900
case("oversized-explanation", set_long_explanation)

def set_extra_field(b):
    b["html"] = "<script>alert(1)</script>"
case("smuggled-top-level-field", set_extra_field)

def set_bad_licence(b):
    b["package"]["licence"] = "All rights reserved"
case("unshareable-licence", set_bad_licence)

def set_no_manifest(b):
    del b["package"]
case("no-manifest", set_no_manifest)

def set_read_first_script(b):
    b["package"]["read_first"]["body"][0] = "Paint is subtractive.<iframe src=//evil.example.com></iframe>"
case("xss-in-the-read-first", set_read_first_script)

for name, b in cases.items():
    with open(os.path.join(out, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(b, f, ensure_ascii=False)
print(" ".join(sorted(cases)))
PY

echo
echo "1. The validator refuses every payload"
# The clean package has to pass first. A suite where everything fails proves
# nothing at all.
if node "$R/tools/validate-package.mjs" --strict "$BASE" >/dev/null 2>&1; then
  ok "the worked example package still passes, so the refusals below mean something"
else
  bad "the worked example package does not pass, so nothing below can be trusted"
fi

for f in "$WORK"/*.json; do
  name="$(basename "$f" .json)"
  if node "$R/tools/validate-package.mjs" --strict "$f" >"$WORK/$name.out" 2>&1; then
    bad "$name was ACCEPTED by the validator"
    sed 's/^/        /' "$WORK/$name.out"
  else
    ok "$name refused"
  fi
done

echo
echo "2. genkan-pack refuses to install one, and nothing reaches the database"
docker exec -i "$PG" psql -U postgres -qc "CREATE DATABASE $DB;" >/dev/null 2>&1 \
  || { echo "could not create a test database"; exit 1; }
out=$(bash "$R/config/db/load.sh" "$DB" "$PG" 2>&1)
if echo "$out" | grep -q FAILED; then
  bad "the schema loads into a fresh database"; echo "$out" | grep FAILED | sed 's/^/      /'
else ok "the schema loads into a fresh database"; fi
# kids_agent is cluster-wide, but USAGE on this brand new database's public
# schema is not, so grant it here. On a real box config/db/grants.sql does it.
psql "GRANT USAGE ON SCHEMA public TO kids_agent;" >/dev/null 2>&1

export GENKAN_DB="$DB" PG_CONTAINER="$PG" GENKAN_REPO="$R"
if GENKAN_DB_ROLE=postgres "$R/bin/genkan-pack" install "$WORK/xss-script-tag.json" >"$WORK/install.out" 2>&1; then
  bad "genkan-pack INSTALLED a package with a script tag in it"
else
  ok "genkan-pack refused to install the script tag package"
fi
n=$(psql "SELECT count(*) FROM quiz_packages")
[ "${n:-x}" = 0 ] && ok "nothing reached quiz_packages" || bad "quiz_packages has ${n} rows after a refused install"
n=$(psql "SELECT count(*) FROM quiz_bank_questions WHERE bank_id LIKE 'xss-%'")
[ "${n:-x}" = 0 ] && ok "nothing reached quiz_bank_questions" || bad "quiz_bank_questions has ${n} rows after a refused install"

# The clean one does install, through the same command, as proof that the
# refusals above are the validator working and not the command being broken.
if GENKAN_DB_ROLE=postgres "$R/bin/genkan-pack" install "$BASE" >"$WORK/good.out" 2>&1; then
  ok "the worked example installs cleanly through genkan-pack"
else
  bad "the worked example would not install"; sed 's/^/      /' "$WORK/good.out"
fi
n=$(psql "SELECT questions FROM quiz_package_summary WHERE bank_id='paint-and-colour'")
[ "${n:-0}" = 40 ] && ok "all 40 questions landed" || bad "expected 40 questions, found ${n:-none}"
[ "$(psql "SELECT live FROM quiz_package_summary WHERE bank_id='paint-and-colour'")" = t ] \
  && ok "it is live to the kids" || bad "it installed but is not live"
[ "$(psql "SELECT read_first IS NOT NULL FROM quiz_packages WHERE bank_id='paint-and-colour'")" = t ] \
  && ok "its read-first material came with it" || bad "the read-first material was dropped"

# The least-privilege role has to be able to do this too, or the command only
# works as a superuser and the grants in schema-packages.sql are decoration.
if GENKAN_DB_ROLE=kids_agent "$R/bin/genkan-pack" remove paint-and-colour >"$WORK/rm.out" 2>&1; then
  ok "kids_agent, with no write access to the quiz tables, can remove a package"
else
  bad "kids_agent could not remove a package"; sed 's/^/      /' "$WORK/rm.out"
fi
n=$(psql "SELECT count(*) FROM quiz_bank_questions WHERE bank_id='paint-and-colour'")
[ "${n:-x}" = 0 ] && ok "removing it took its questions with it" || bad "${n} questions left behind"

# A bank a parent wrote on the dashboard is not a package and must survive any
# attempt to remove it this way, whatever id is handed in.
psql "INSERT INTO quiz_banks(id,title) VALUES('mums-spelling','Mum spelling');" >/dev/null
out=$(psql "SELECT remove_quiz_package('mums-spelling', false)")
case "$out" in
  *"not an installed package"*) ok "a bank the household wrote cannot be removed as a package" ;;
  *) bad "remove_quiz_package touched a bank that was not a package: $out" ;;
esac
[ "$(psql "SELECT count(*) FROM quiz_banks WHERE id='mums-spelling'")" = 1 ] \
  && ok "the household's own bank is still there" || bad "the household's own bank was deleted"

echo
echo "3. If a payload got in anyway, the portal still renders it inert"
# Straight past the validator and the CLI, into the database, by calling the
# install function by hand as the superuser. This is the "somebody found a hole
# in the validator" case, and the portal has to survive it on its own.
python3 - "$WORK/xss-script-tag.json" > "$WORK/force.sql" <<'PY'
import json, sys
p = json.load(open(sys.argv[1], encoding="utf-8"))
# Make it fit the database's own constraints so the only thing being tested is
# the escaping, not the column widths.
p["questions"][0]["choices"][1] = "<img src=x onerror=alert(1)>"
p["package"]["read_first"]["body"][0] = "<script>alert('read first')</script>"
lit = lambda s: "'" + s.replace("'", "''") + "'"
print("SELECT install_quiz_package(%s::jsonb,'forced','test','none');"
      % lit(json.dumps(p, ensure_ascii=True, separators=(",", ":"))))
PY
if docker exec -i "$PG" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 < "$WORK/force.sql" >/dev/null 2>&1; then
  ok "the payload was forced into the database, past every check"
else
  bad "could not force the payload in, so part 3 proves nothing"
fi

# Now render it with the portal's OWN escaping function, lifted out of
# dashboard/portal.mjs at run time rather than copied. If somebody weakens
# esc() in that file, this test fails, which is the entire point of reading it
# from the source instead of reimplementing it here.
docker exec -i "$PG" psql -U postgres -d "$DB" -tA \
  -c "SELECT row_to_json(t) FROM (
        SELECT (SELECT jsonb_agg(jsonb_build_object('prompt',prompt,'choices',choices,'explanation',explanation))
                  FROM quiz_bank_questions WHERE bank_id='xss-script-tag') AS qs,
               (SELECT title FROM quiz_banks WHERE id='xss-script-tag') AS title,
               (SELECT read_first FROM quiz_packages WHERE bank_id='xss-script-tag') AS rf) t" \
  > "$WORK/stored.json" 2>/dev/null

node - "$R/dashboard/portal.mjs" "$WORK/stored.json" <<'JS' > "$WORK/render.out" 2>&1
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2], "utf8");
// Lift the real escaping function out of the real file. No copy, no rewrite.
const m = src.match(/^const esc = .*$/m);
if (!m) { console.log("NOESC"); process.exit(0); }
const esc = eval(`(${m[0].replace(/^const esc = /, "").replace(/;$/, "")})`);
const stored = JSON.parse(readFileSync(process.argv[3], "utf8"));

// The exact shapes dashboard/portal.mjs builds for the study page and the
// quiz card, with the stored payload in them.
let html = `<h1>${esc(stored.title)}</h1>`;
for (const q of stored.qs || []) {
  html += `<p class="s-p">${esc(q.prompt)}</p>`;
  for (const c of q.choices || []) html += `<label><input type=radio>${esc(c)}</label>`;
  html += `<p class="s-e">${esc(q.explanation || "")}</p>`;
}
for (const p of (stored.rf && stored.rf.body) || []) html += `<p>${esc(p)}</p>`;

// Every tag left in the rendered page must be one this test wrote itself.
const allowed = new Set(["h1", "p", "label", "input", "/h1", "/p", "/label"]);
const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(t => t[0].slice(1).toLowerCase());
const smuggled = [...new Set(tags)].filter(t => !allowed.has(t) && !allowed.has("/" + t));
console.log("TAGS " + [...new Set(tags)].join(","));
console.log("SMUGGLED " + (smuggled.length ? smuggled.join(",") : "none"));
// An event handler only does anything inside a tag. The payload's "onerror="
// survives as TEXT, which is the correct outcome and must not be reported as a
// failure, so this looks inside the real tags rather than at the whole string.
const openTags = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map(t => t[0]);
console.log("HANDLERS " + (openTags.some(t => /\son[a-z]+\s*=/i.test(t)) ? "yes" : "none"));
// And prove the payload really did arrive, rather than the test having escaped
// an empty string and congratulated itself.
console.log("NEUTRALISED " + (html.includes("&lt;script&gt;") && html.includes("&lt;img") ? "yes" : "no"));
console.log("SAMPLE " + (html.match(/.{0,40}&lt;img.{0,60}/) || [""])[0]);
JS

if grep -q "^NOESC" "$WORK/render.out"; then
  bad "could not find esc() in dashboard/portal.mjs, so the escaping was not tested"
else
  grep -q "^SMUGGLED none" "$WORK/render.out" \
    && ok "the stored payload renders with no tag the portal did not write itself" \
    || { bad "a tag survived escaping"; sed 's/^/      /' "$WORK/render.out"; }
  grep -q "^HANDLERS none" "$WORK/render.out" \
    && ok "no HTML event handler survives escaping" \
    || { bad "an event handler survived escaping"; sed 's/^/      /' "$WORK/render.out"; }
  grep -q "^NEUTRALISED yes" "$WORK/render.out" \
    && ok "the payload is still in the page, as visible text a child would just read" \
    || { bad "the payload is not in the rendered page at all, so nothing was proved"; sed 's/^/      /' "$WORK/render.out"; }
  echo "      it renders as: $(grep '^SAMPLE' "$WORK/render.out" | cut -c8-130)"
fi

echo
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
