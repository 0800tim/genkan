# Releasing Genkan

How a version of Genkan gets a number, and how one is cut. If you are a
household wanting to update, you want [UPGRADING.md](UPGRADING.md) instead.

## The version scheme: dated release trains

`VERSION` holds one line and nothing else:

```
2026.09.0
```

That is `YEAR.MONTH.PATCH`. `2026.09.0` is the first release of September
2026. `2026.09.1` is a fix to it. `2026.10.0` is the next month's release.

### Why dated and not semantic versioning

Semantic versioning answers "will this break my code". That is the right
question for a library with other programmers downstream. Genkan has none.
It is one repository, deployed one way, on one box, by a family.

The question a Genkan household actually asks is **"am I running something
old?"** and dates answer it without a changelog, a comparison, or an internet
connection. A parent who opens the dashboard, sees `Genkan 2025.03.0`, and
knows it is now 2026 has learned something useful in one glance. The same
parent seeing `Genkan 1.4.2` has learned nothing at all.

The rest of the reasoning:

- **The audience is families, not developers.** "It is from March last year"
  is a sentence anyone can act on. "It is two minor versions behind" is not.
- **The compatibility question is answered elsewhere and better.** The only
  change here that can genuinely break an upgrade is a database change, and a
  major version number is far too blunt an instrument for that. The release
  notes say it per release, `kidnet-upgrade check` says it out loud before you
  agree to anything, and `docs/UPGRADING.md` says what to do about it.
- **It stays sortable.** Three dot separated numbers, so `sort -V`,
  `git tag --sort=-v:refname` and every tool that expects a version still
  work. Nothing had to be taught a new format.
- **It makes staleness visible to us too.** A project with no release in
  eight months is a project that should say so on its own front page.

What was rejected, and why:

| Rejected | Why |
|---|---|
| Semantic versioning (`1.4.2`) | Answers a question nobody here is asking, and hides the one they are: how old is this. |
| Plain dates (`2026-09-30`) | No room for a fix to a release inside the same month without pretending it is a different day. |
| Sequential build numbers (`#412`) | Meaningless to a parent, and meaningless to us six months later. |
| A codename per release | Charming, and useless when somebody is reading a version number down the phone. |

### The rule about the VERSION file

`VERSION` on the main branch always names **the release being prepared**, not
the last one shipped. So the moment `2026.09.0` is tagged, the next commit
bumps `VERSION` to `2026.10.0`.

That means a box running the main branch between releases is running something
that is not `2026.09.0` and is not yet `2026.10.0`. The tooling says so rather
than pretending, because a version number that lies is worse than none:

```
Genkan 2026.10.0 (12 change(s) since the release, edited on this box)
```

`bin/kidnet-health`, `kidnet-upgrade status` and the dashboard footer all print
that same line, from `hearth_version_line()` in `bin/kidnet-release-lib.sh`.
One implementation, so they cannot drift apart.

## Cutting a release

Everything below is done on a development machine, never on a household's
gateway.

### 1. Everything must pass

```bash
sudo test/firewall-test.sh      # 46 checks, the firewall
sudo test/container-test.sh     # 26 checks, the isolation
sudo test/roles-test.sh         # 108 checks, who may do what
sudo test/release-test.sh       # 42 checks, upgrade and rollback still work
sudo test/iot-policy-test.sh    # 39 checks, the household gadgets
test/schema-test.sh             # 88 checks, a fresh install loads
test/db-role-test.sh            # 77 checks, the CLI cannot leave the database
test/schedule-test.sh           # 57 checks, bedtimes and who may lift a block
test/notify-test.sh             # 41 checks, what a lock screen may say
test/package-test.sh            # 31 checks, a community module cannot bite
test/alerts-test.sh             # 15 checks, the safety alert path runs
test/tor-test.sh                # 25 checks, the relay list reaches the firewall
test/adguard-test.sh            # 9 checks, needs ADGUARD_PASS
test/meter-test.sh              # 8 checks, time accounting
test/service-meter-test.sh      # 6 checks, per-service time
node tools/validate-quizzes.mjs # every quiz bank still parses and ramps
```

Run them one at a time, not in parallel. Several build a throwaway database or
a network namespace with a fixed name, so two suites running at once collide
and report failures that are not real. If a suite fails, run it alone before
believing it.

One caution on a shared Postgres server: `db-role-test.sh`, `schema-test.sh`
and `alerts-test.sh` each create a database and drop it again, which can break
a whole-instance backup that enumerates databases mid-run. See OPERATIONS.md.

`test/release-test.sh` is the one that is easy to forget and the one that
matters here: it proves that a household that takes this release can get off
it again.

### 2. Decide the number

- A month with no release yet: `YYYY.MM.0`.
- Fixing a release that is already out in the same month: bump the patch.
- Never reuse a number. A tag that has moved is a household that cannot tell
  what it is running.

### 3. Write the release notes

Every release needs a `## <version>` section in `docs/UPGRADING.md`, and it
must answer three things in plain language:

1. What changed, for a parent, not for a programmer.
2. **Does this release change the database?** `git diff --name-only <last-tag>..HEAD -- config/db/` tells you. If it does, say so, and say
   whether a rollback from it needs `--with-database`.
3. Anything a household has to do by hand. Ideally nothing.

If a release drops or renames a database column, say so in capital letters.
That is the one change a rollback cannot fully undo, and the household needs
to read it before they upgrade, not after.

### 4. Tag it

```bash
# VERSION already holds the number being released.
git tag -a v2026.09.0 -m "Genkan 2026.09.0"
git push origin main --tags
```

The tag is `v` plus the contents of `VERSION`. `bin/kidnet-upgrade` finds
releases with `git tag -l 'v[0-9]*' --sort=-v:refname`, so a tag in any other
shape is invisible to every household.

### 5. Open the next one

```bash
printf '2026.10.0\n' > VERSION
git commit -am "open 2026.10.0"
```

## What a household actually receives

`kidnet-upgrade` follows tags, not branches. A household never gets the tip of
main unless somebody deliberately types `--to origin/main`. That is the whole
of the release channel design, and it is deliberate: the default has to be
"a version a person decided was finished", because the default is what runs
in houses with children in them.

## The release log

Every install, upgrade and rollback appends a row to `release_history`
(`config/db/schema-release.sql`). It is append only. `kidnet-upgrade status`
prints the last ten. It exists so that "it broke on Tuesday" can be turned
into "it broke twenty minutes after 2026.10.0 went on, and here is the
rollback that followed".

## Files this touches

| File | What it is |
|---|---|
| `VERSION` | one line, the version. The whole contract. |
| `bin/kidnet-release-lib.sh` | shared helpers: where the code is, what version, the release log |
| `bin/kidnet-health` | is this household working (read only) |
| `bin/kidnet-upgrade` | check, snapshot, apply, undo itself if it breaks |
| `bin/kidnet-rollback` | go back deliberately |
| `config/db/schema-release.sql` | the release log |
| `test/release-test.sh` | proves the above on a throwaway clone |
| `dashboard/version.mjs` | the quiet line at the bottom of every page |
