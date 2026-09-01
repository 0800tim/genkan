# Community packages and the registry

**Status: a design, not a feature.** Almost everything on this page is
proposed. The one part that exists today is the quiz package: one JSON file,
validated as hostile input, installed into the household database by
`bin/genkan-pack`. The table at the end says exactly which lines are built.

This page answers one question the project has now reached: where does
content live once there is a lot of it, and once most of it is written by
people who are not maintainers of Genkan?

## The short version

- Content lives in a **public, git-backed registry**, not in the product
  repository and not in a database we run. An index repo on GitHub, a static
  JSON index published at `genkan.nz/registry`, and each package as a signed
  file attached to a release. Nothing on our side is a server that answers
  questions.
- The **product repo ships a starter set** (the banks in `portal/quizzes/`,
  the reading list, the default tiers) so a fresh install teaches something
  on day one with no network at all. Everything else arrives through the
  registry, so content grows without a product release.
- The **house database holds only what is installed.** Installing a package
  is a database write. Removing it deletes exactly the rows it added. A
  package can never run anything on the box.
- Five kinds of package: quiz banks (built), reading-list rules, filter rule
  sets and tier presets, bedtime presets, and project modules (proposed).
- Every kind is validated the way quiz packages are validated today: every
  string treated as hostile, every link held to the reading list, every size
  capped, and the portal escaping everything again on the way out.
- The registry is fetched only when a parent asks, from the parent's side of
  the house, never from the island, and it works offline once installed.

## 1. Repo, or a central database?

The question as it was put: content modules are going to arrive all the
time, hopefully without every one of them going through a contributor to the
product. Should they live in the repo and be pulled from there, or in a
central database?

Neither, exactly. Here is the reasoning.

### Why not the product repo

`portal/quizzes/` is tracked in git. That is fine for forty banks and it is
already the wrong place for content a household chose: a `git pull` would
delete a family's installed package, and a repo update would silently
overwrite it. This is why installed packages went into the database in the
first place (DECISIONS.md, "Anyone should be able to teach something").

It also ties content to releases. Genkan releases are dated trains that a
person decided were finished (`docs/RELEASING.md`). A woodworking module
written in October should not wait for `2026.11.0`, and a fix to one wrong
answer should not need a product patch. A repo full of thousands of
questions also makes every clone heavier for the parent who only wanted the
gateway.

### Why not a central live database

A database we run, that every house queries, would be the first thing in
Genkan that watches households. Even with the best intentions it would see
which house asked for what and when, it would go down when we did, and it
would be a place where an account eventually appears "to make things
easier". `PRIVACY-CHARTER.md` P1 (no telemetry) and P2 (no cloud dependency
for anything that matters) both rule it out, and both would have to be
rewritten to allow it. They should not be.

### The registry: static files, signed, mirrored

What is proposed instead is the shape package managers settled on years ago:

| Piece | What it is | Where |
|---|---|---|
| The index repo | a public git repository holding one metadata file per package version, the validators, and the CI that runs them | GitHub, proposed name `genkan-registry` |
| The index | one static JSON file listing every package: id, kind, version, hash, signature, review state, tags, author, licence, size | built by CI and published at `genkan.nz/registry/index.json`, and committed back into the index repo so a clone of the repo is a complete mirror |
| The packages | the JSON files themselves, one per version, never changed after publication | attached to a GitHub release of the index repo, or served next to the index from the same static host |
| The signing key | one registry key that signs the index and every package that passed CI and review | the public half is in the product repo, so a box can verify without fetching anything first |

Nothing here answers a query. A household downloads a file that is the same
for everybody, checks its signature against a key it already has, and does
the searching locally. The whole registry can be cloned with `git clone` and
carried into a house on a USB stick. If genkan.nz vanished, every installed
package keeps working, because installed means "in the house database", and
the index repo would still be a public git repository anybody could host.

### What the registry must do to keep the promise

These are the rules the design has to hold to, and the reasons they matter.
They are written as rules so a future change that breaks one has to say so.

1. **Static files only.** No endpoint takes a parameter. There is nothing to
   search on the server side, so there is nothing to log about who searched.
2. **No accounts.** Not for readers, ever. Authors have a GitHub account
   because that is how a pull request works, and that is the only identity in
   the system.
3. **No per-house telemetry.** The box sends nothing but a plain HTTP request
   for a static file, and only when a parent types the command. There is no
   install ping, no update beacon and no version report. Whatever ordinary
   web server logs the static host keeps, we do not read them per house and
   there is nothing in the request that names a house.
4. **Counts, if ever, are opt-in and off.** The first version has no
   download or install counts at all. If the community ever wants "installed
   by N houses", the only acceptable design is a parent-run, opt-in, one-off
   request with no identifier in it, and it needs a charter change first.
   This page recommends against building it.
5. **Everything works offline once installed.** The validator, the signature
   check and the install run on the box with no network. The index is cached
   at `/var/lib/genkan/registry/` and `genkan pack search` searches the cache,
   saying how old it is.
6. **The fetch is a charter change and must be recorded as one.** Today P1
   lists exactly one outbound request Genkan's own code makes (the Tor relay
   list). A registry fetch is a second one. Adding it means editing P1 to
   name it, in the same pull request, exactly as the charter requires. It
   downloads a public file and uploads nothing, which is the same shape as
   the Tor fetch, but it does not get to be quiet about existing.
7. **A household can point at a different registry, or none.** A school, a
   tutor or a family could run their own index repo with their own key. That
   is proposed as `genkan pack source`, with the Genkan registry as the
   default and "no registry" as a supported setting.

## 2. Package kinds

One file per package, whatever the kind, because one file is the thing a
person can email or attach to an issue (DECISIONS.md has the reasoning). The
kinds below share a top-level `package` block that already exists for quiz
banks, with one field added: `kind`. A package with no `kind` is a quiz bank,
which keeps every existing package valid.

```json
"package": {
  "format": 2,
  "kind": "quiz",
  "author": "A name or a handle",
  "licence": "CC-BY-4.0",
  "description": "Who it is for and what they get out of it.",
  "tags": ["making", "hands-on"],
  "updated": "2026-09-02",
  "sources": ["https://en.wikipedia.org/wiki/Knot"]
}
```

Every kind is validated as hostile input with the rules `tools/validate-package.mjs`
applies to quiz text today: `<`, `>` and `&` must stand alone with a space
either side; no invisible or direction-changing characters; no `javascript:`
or `data:` URLs; no event-handler names; every field capped at the size its
database column allows; every URL `https` and on the reading list; no unknown
fields anywhere. A package of one kind may not carry the fields of another.
The portal and the dashboard escape every field again when they render it.
`test/package-test.sh` would grow one hostile fixture per kind.

### 2.1 Quiz banks (built)

The existing format: `portal/quizzes/FORMAT.md` for the bank, `docs/CONTRIBUTING-CONTENT.md`
for the manifest and the read-first page. Installed by `install_quiz_package()`
into `quiz_banks`, `quiz_bank_questions` and `quiz_packages`. Nothing here
changes for it except `format: 2` becoming accepted alongside 1.

### 2.2 Reading-list rules (proposed)

A set of sites a cut-off child can still reach. Rows for `always_allow` with
`scope='learn'`, exactly as `docs/READING-LIST.md` describes.

```json
{
  "id": "marine-reference-nz",
  "package": { "kind": "reading-list", "format": 2, "author": "...", "licence": "CC0-1.0",
               "description": "Tide tables, marine weather and the NZ coastal atlas, for the boat-building module." },
  "rules": [
    { "domain": "niwa.co.nz",       "category": "science",   "note": "NIWA: tides, marine weather, the coastal atlas." },
    { "domain": "linz.govt.nz",     "category": "reference", "note": "Charts and tide predictions from the source." },
    { "domain": "duckduckgo.com",   "category": "search",    "note": "Exact host only. Search without a feed." }
  ]
}
```

Rules of the kind:

- The package cannot set `scope`. It is always `learn`. A package can never
  add to, remove from, or touch a `scope='safety'` row. If a domain in the
  package is already on the safety list, the row is skipped and the parent
  is told, never downgraded.
- `category='search'` rows are matched as exact hosts by `bin/genkan-adguard`
  and everything else covers its subdomains, so the validator requires a
  bare hostname: lowercase, no scheme, no path, no wildcard, no port, no IP
  address, and at most 24 rules per package.
- Install writes rows with a `source_package` column (a proposed addition to
  `always_allow`) holding the package id, so removal deletes only what the
  package added and never a row the household typed in.
- A domain the household already has stays the household's: the install
  skips it and reports it rather than claiming it.
- The validator can check syntax and resolve each name. It cannot run the
  five tests in `docs/READING-LIST.md`; a human does that in review, and the
  well-known rejections in that document are the bar.
- After install, `genkan allow-sync` runs so the firewall learns the
  addresses. Without it the rows would sit in the database for up to an hour
  doing nothing, which is the kind of quiet gap this project has been bitten
  by before.

### 2.3 Filter rule sets and tier presets (proposed)

Two related kinds, kept separate because they carry different risk.

A **filter rule set** adds domains to the categories the meter and the
blocks already understand (`category_domains`): a regional streaming
service, a country's gaming CDN, the social apps popular in one place.

```json
{
  "id": "streaming-nz-au",
  "package": { "kind": "filter-rules", "format": 2, "author": "...", "licence": "CC0-1.0",
               "description": "The NZ and Australian streaming services and their CDN names, so video is metered here." },
  "categories": {
    "video": ["tvnz.co.nz", "threenow.co.nz", "neontv.co.nz", "9now.com.au", "abc.net.au"]
  }
}
```

A **tier preset** is a named set of values for the `policies` table: which
categories a tier blocks, safe search, restricted YouTube, and the daily
budgets.

```json
{
  "id": "primary-school-strict",
  "package": { "kind": "tier-preset", "format": 2, "author": "...", "licence": "CC0-1.0",
               "description": "For a house with children under ten. Blocks gaming and social on school nights." },
  "tiers": {
    "young": { "block_categories": ["gaming", "social", "video"], "safesearch": true,
               "youtube_restricted": true, "daily_budget_school_min": 45, "daily_budget_weekend_min": 90 }
  }
}
```

Rules of the kinds:

- **The safety net is never narrowable by a package.** A filter rule set
  cannot name a domain that is on the safety list in any category. A tier
  preset cannot set `force_dns` to false, and the validator refuses the
  field outright rather than ignoring it. These are the iron rules in
  `CLAUDE.md` restated for content, and `test/package-test.sh` would carry a
  fixture for each.
- A filter rule set adds rows tagged with the package id and removal deletes
  only those. It can add to a category; it cannot remove a domain that
  ships with Genkan or that the household added.
- A tier preset is **installed to a shelf, not applied.** Applying it
  overwrites a household's tier, which is a big deal in a house where the
  values were tuned over months. So `genkan pack install` puts it in a
  proposed `tier_presets` table, and `genkan pack apply <id>` shows the
  difference against the current tier, line by line, and asks. Removing the
  package removes it from the shelf and changes nothing about a tier that
  was applied from it, because by then the values are the household's.
- Categories are limited to the ones Genkan meters (`config/db/schema-categories.sql`).
  A package cannot invent a category, because nothing would meter it.

### 2.4 Bedtime presets (proposed)

Rows for `schedules`: a school-night window, a weekend window, a homework
hour. Useful because a new household otherwise starts from a blank table and
the sensible defaults for a nine year old are not obvious.

```json
{
  "id": "nz-primary-bedtimes",
  "package": { "kind": "bedtimes", "format": 2, "author": "...", "licence": "CC0-1.0",
               "description": "School nights off at 8, weekends at 9, everything back at 7. For children under eleven." },
  "schedules": [
    { "name": "school night", "days": [0, 1, 2, 3, 4], "start": "20:00", "end": "07:00", "categories": ["internet"] },
    { "name": "weekend",      "days": [5, 6],          "start": "21:00", "end": "07:30", "categories": ["internet"] }
  ]
}
```

Rules of the kind:

- Applied per child by a parent, never to everybody by default. Install puts
  it on a shelf; `genkan pack apply <id> <child>` writes the rows with
  `set_by='package:<id>'` so they can be found and removed as a set.
- Nothing about who may lift a block changes. A schedule installed from a
  package lifts only blocks marked `set_by='bedtime'`, exactly as one typed
  by a parent does. The precedence table in DECISIONS.md ("Bedtimes ran
  themselves") is not touched by this design and must not be.
- The validator checks times, days, the category list against the known
  categories, and a cap of eight windows. It cannot know what bedtime is
  right for a child, and the description has to say who it is for.

### 2.5 Project modules (proposed, and the interesting one)

The woodworking module. The model boat. A thing a child builds over a few
weekends, with steps to follow, materials to gather, and points where a
parent looks at what was made and says yes.

```json
{
  "id": "model-boat-balsa",
  "title": "Build a balsa model boat",
  "emoji": "⛵",
  "suggested_age_min": 9,
  "package": { "kind": "project", "format": 2, "author": "...", "licence": "CC-BY-4.0",
               "description": "A flat-bottomed balsa boat that floats level. Four sessions, hand tools only, an adult for the knife work.",
               "tags": ["making", "woodwork", "outdoors"],
               "sources": ["https://en.wikipedia.org/wiki/Buoyancy"] },
  "materials": [
    { "item": "Balsa sheet, 3 mm, about 300 by 100 mm", "optional": false },
    { "item": "PVA glue", "optional": false },
    { "item": "Sandpaper, 120 and 240 grit", "optional": false },
    { "item": "Acrylic paint", "optional": true }
  ],
  "steps": [
    { "id": "hull", "title": "Cut and shape the hull",
      "body": ["Draw the hull outline first, and cut outside the line.", "Sand to the line. Sanding is where the shape comes from, not the knife."],
      "read": [{ "label": "Why a boat floats, in Simple English", "url": "https://simple.wikipedia.org/wiki/Buoyancy" }] },
    { "id": "float", "title": "Float test",
      "body": ["Put it in the sink. If it lists, sand the heavy side. If it sits low, it is too heavy for its footprint."] }
  ],
  "evidence": [
    { "id": "hull-done",  "after": "hull",  "ask": "Show a parent the shaped hull.", "minutes": 20 },
    { "id": "it-floats", "after": "float", "ask": "Show a parent it floating level in the sink.", "minutes": 30 }
  ],
  "quiz": "model-boat-balsa-quiz",
  "badge": { "emoji": "⛵", "title": "Shipwright" }
}
```

How it would map onto what Genkan already has:

- **Steps and materials** render on the portal like a read-first page does
  today: text and reading-list links. Same limits: no images, no video, and
  the honest reason is written in `docs/CONTRIBUTING-CONTENT.md`. A module
  that cannot be taught without a picture is real evidence for building
  asset support, and it should say so in its pull request.
- **Evidence a parent confirms** is a chore claim. `tasks` and `earn_claims`
  already do "the child taps I did it, a parent approves on the dashboard,
  the minutes land through `time_events`". A module installs one task per
  evidence item, tagged with the package id. The child claims it from the
  module's page; the parent sees the claim with the module's own words
  ("Show a parent it floating level in the sink") next to it.
- **Earn value** is per evidence item, and the validator caps it: at most 60
  minutes for one item and at most 180 for a whole module. A household can
  change any of it after install, exactly as it can change what a bank pays,
  and a module that pays absurdly will simply be turned down in review.
- **Order** matters a little: an evidence item names the step it follows,
  and the portal offers them in order. It does not lock later items, because
  a parent can see what was actually made and a lock would only invite an
  argument.
- **The quiz** is optional and is a separate quiz package the module names.
  Two files, because a quiz bank is already a thing and the validator for it
  already exists. The registry index marks the dependency so `genkan pack
  install model-boat-balsa` offers to fetch the quiz too.
- **Badges** are the part that needs a small product change. Badges today
  are a fixed list in `dashboard/badges.mjs`, awarded by rules that read the
  database. A module cannot define a new rule, and it should not. What it
  can do is name a title and an emoji for one generic badge, "project
  finished", awarded once every evidence item in the module is approved,
  with the module's title and emoji in `child_badges.meta`. Text and emoji
  only, escaped like everything else. It stays a personal milestone. It
  never appears on the house board, which stays off by default.

Everything in the module is text a stranger wrote, going in front of a
child, so the same validator rules apply to every step, every material and
every evidence line. Materials are text, not links, and the validator
refuses a URL in them. That is deliberate: a module is not allowed to be a
shop.

## 3. Trust

Trust here has to be earned by the mechanism rather than by us, because the
person installing a package has no way to check who we are.

### Signing

Proposed: OpenSSH signatures, `ssh-keygen -Y sign` and `ssh-keygen -Y verify`,
because OpenSSH is on every box Genkan runs on and no new dependency is
needed. minisign would do the same job with a smaller tool and is the
fallback if the OpenSSH route proves awkward in CI. Two signatures per
package:

| Signature | Made by | Means |
|---|---|---|
| author | the author, optional, with a key they publish in the index repo | "this file is the one I sent" |
| registry | CI, required, with the registry key | "this exact file passed every validator and was merged by a maintainer" |

The registry's public key ships in the product repo, so the first fetch can
be verified without trusting the network it came over. `genkan pack install`
refuses a file whose registry signature does not verify, before it runs the
validator and before anything reaches the database. A package handed over
by hand, with no signature, still installs the way it does today, with the
warning it prints today: nobody has checked this for you.

### Pinned hashes

The index carries the sha256 of every package version and the box checks it
on download. `quiz_packages.checksum` already records what was installed, so
`genkan pack list` can say whether what is on the box is what the registry
published, and `genkan pack update` can tell a real update from a re-upload.
A published version is never changed. A fix is a new version.

### The review flag

Every index entry carries one of three states, and the CLI prints it:

| State | Means |
|---|---|
| `validated` | CI ran every validator and the file passed. Nobody has read it. |
| `checked` | A named person read every question, answer and explanation and says so in the index entry. |
| `withdrawn` | Pulled after publication. Still listed so an installed copy can be recognised and the parent told why. |

`checked` is a person's name on the line, in public. That is the whole
review system, and it is honest about what it is: a validator cannot tell a
wrong answer from a right one, and a wrong answer takes minutes off a child
for being right.

### A package can never execute anything

Every kind is JSON. There are no scripts, no hooks, no post-install steps and
no code paths that read a package as anything but data. Install is one
`SECURITY DEFINER` function per kind, called as `kids_agent`, the role with
no DDL and no direct write on the tables (`config/db/grants.sql`). That is
how quiz packages work today and it is the pattern every other kind copies.
The Omarchy plugin marketplace, which is otherwise a good model for
submission by pull request, says plainly that its plugins run unsandboxed
with the user's permissions. Genkan packages never run at all.

### Uninstall is clean

Every row a package writes carries its id. Removal deletes those rows and
nothing else, in one transaction, and refuses anything the household made
itself. What a child earned stays earned: `time_events` and `quiz_rounds`
have no foreign key to the content, which is already how quiz packages are
removed.

## 4. The command line, and the dashboard

Today: `genkan-pack list|validate|install|remove`, a separate script that
takes a file. Proposed: the same script gains a registry, and `genkan pack`
becomes the door to it so the CLI has one front.

```
genkan pack search [words]           search the cached index; says when it was fetched
genkan pack info <id>                kind, author, licence, review state, versions, size, what it would write
genkan pack install <id|file>        fetch, verify hash and signature, validate, install
genkan pack update [id|--all]        refresh the index, list newer versions, install the ones you name
genkan pack remove <id>              delete every row it added
genkan pack list                     what is installed, and whether the registry has a newer one
genkan pack apply <id> [child]       tier presets and bedtimes only: put a shelf item into effect
genkan pack source [url|none]        which registry, or no registry
```

How the index is fetched, because this is the part that touches the
charter:

- **From the host, never from the island.** `bin/` runs on the host, outside
  the container's network namespace, on the parent's ordinary connection.
  The gateway container cannot fetch it and is never asked to. A child's
  device cannot reach the registry through the island because the registry
  is not on the reading list and does not need to be.
- **Only when a parent types the command.** No timer. `genkan pack search`
  and `genkan pack update` fetch; nothing else does. A cached index is used
  for everything else and its age is printed.
- **A plain GET of a static file**, with nothing in the request that names a
  house. The user agent is `genkan-pack` with no version, because a version
  is a fingerprint.

The dashboard's role stays read-only, as it is today. The Learn to earn
screen lists what is installed with the author, licence and review state,
shows what the cached index says is available and newer, and prints the
command. It does not fetch and it does not install. The existing decision
that installing a stranger's writing is a deliberate act at a terminal
(DECISIONS.md, "Installed packages live in the database") stands until
somebody argues it down with a better reason than convenience. An install
button for `checked` packages is a fair thing to want and is listed as an
open question rather than built in by default.

## 5. The community process

### Proposing a package

1. Write it. `docs/CONTRIBUTING-CONTENT.md` for a quiz, and a section per
   kind on the same page once the kinds exist.
2. Run the validator locally. It needs a checkout and Node, nothing else.
3. Open a pull request against the index repo (not the product repo) adding
   `packages/<id>/<version>.json` and a short entry file saying who it is
   for. CI runs the validator for that kind and refuses the merge on any
   failure. A wrong answer is not something CI can see, so the pull request
   template asks where each answer was checked.
4. A maintainer or a named reviewer reads it, marks it `validated` or
   `checked`, and merges. CI signs it, rebuilds the index and publishes.
5. A fix is a new version. Nothing already published changes.

An issue with the file attached is the same process with somebody else
opening the pull request, and it is not a lesser route.

The point of putting this in an index repo rather than the product repo is
that a content reviewer does not need to know anything about the firewall,
and a firewall reviewer does not need to read forty questions about knots.
The two communities overlap but they are not the same people.

### The empty-category problem

A registry with one woodworking module in it looks abandoned, and a category
page with nothing on it is worse than no page. Three things, none of them
clever:

- **Seed it from what already exists.** The forty-odd banks in the product
  repo become the first entries. The reading list becomes a reading-list
  package. The default tiers become a tier preset. On day one the registry
  is not empty, it is the product's own content with a manifest on it.
- **Tags, not categories.** The index has no fixed category list, so there
  is no empty shelf to stare at. `genkan pack search woodwork` either finds
  something or says so.
- **A wanted list.** The index repo carries `WANTED.md`: the modules people
  have asked for and nobody has written. A blank page that says "somebody
  asked for a model boat module" is an invitation; a category page that
  says "0 packages" is a gravestone.

### What makes a good module

`CONTRIBUTING.md` has the rules for a good question and a good explanation,
and they carry straight over: written for the child who got it wrong,
plausible wrong answers, a difficulty on every question, nothing that dates.
For a project module, three more, learned from the paint package:

- A step is one thing a child can do in one sitting, and it says how they
  will know it worked.
- The evidence line is what a parent will actually look at, in plain words.
  "Show a parent it floating level" is checkable. "Complete the hull" is not.
- The read links are the whole lesson for the child who has run out of time,
  so pick the one page on the reading list that explains the idea, not six.

### The bug bounty, extended to content

`BUG-BOUNTY.md` is a house rule: find a way round the network, show a parent
how, earn a reward, and the hole is fixed for every family. Content gets the
same deal, and it is a better teacher than the network side because the
child has to know the subject to win.

| Level | Find | Teaches |
|---|---|---|
| 1 | A wrong answer in a package | how to check a fact against a source |
| 2 | An explanation that would teach the wrong idea | the difference between a right answer and a right reason |
| 3 | A way to earn minutes from a module without doing the work | what a rule is for, and how to write one that holds |
| 4 | Text the validator should have refused | reported privately through `SECURITY.md`, never as a public issue |

The household decides the reward, as it does today. The report goes to the
index repo as an issue, the fix goes out as a new version, and the child's
name goes in the entry file if they want it there. A child who found a
wrong answer in a stranger's quiz and got it fixed for every other family
has learned the thing the whole project is for.

## 6. Kits

A module about a model boat wants balsa, glue and sandpaper. It is possible
that one day a kit of materials could be offered alongside a module by
whoever wrote it, or by us, and it would never be required: every module in
the registry has to be usable with what a household can buy locally, and a
module whose steps only work with a particular kit will not be accepted.

## 7. What is built today, and what is not

| | |
|---|---|
| Quiz package format, one file, manifest, read-first page | built |
| Validator treating every string as hostile | built, for quiz packages |
| Install into the database as a narrow `SECURITY DEFINER` function | built, for quiz packages |
| Clean removal that leaves earned minutes alone | built, for quiz packages |
| The portal escaping every field on the way out | built |
| A test suite proving both defences separately | built, `test/package-test.sh`, 31 checks |
| A community shelf in the repo, nothing live until installed | built, `portal/quizzes/community/`, one worked example |
| Dashboard listing what is installed and what is on the shelf | built, read-only |
| `kind` in the manifest and `format: 2` | not built |
| Reading-list packages | not built, and `always_allow` has no `source_package` column yet |
| Filter rule sets | not built |
| Tier presets and `genkan pack apply` | not built, and there is no `tier_presets` table |
| Bedtime presets | not built |
| Project modules: steps, materials, evidence, earn value | not built |
| A package-named badge | not built; badges are a fixed list in `dashboard/badges.mjs` |
| The index repo, CI, signing, the published index | not built |
| Registry signature and hash checks in `genkan-pack` | not built; it checks nothing but the validator |
| `genkan pack search|info|update|source` | not built; `genkan-pack` takes a file and nothing else |
| The charter change naming the registry fetch | not written |
| A household running its own registry | not built |
| Install or update counts | not built, and recommended against |
| Images, audio or video in any package | not supported, for the reasons in `docs/CONTRIBUTING-CONTENT.md` |

The honest summary: one kind exists and it is done properly. The other four
and the registry around them are a design on a page, and this page says so
in every section so that nobody reads an intention as a feature.
