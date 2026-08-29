# HEARTH security review, 2026-08-30

> ## Status: read this before quoting any finding below
>
> This is a point-in-time audit, not a list of open problems. **Several of the
> findings in it were fixed within hours of it being written**, and the fixes
> are in the repository you are reading. A reviewer, human or AI, who quotes a
> finding from here without checking the code will report a closed issue as
> open, which has already happened once.
>
> Check `git log` and the code before believing anything below is still true.
> Where a finding has been fixed, it is marked **FIXED** with the commit.
>

Second adversarial, read-only audit of the gateway at
`/srv/projects/internal/kids-network`. Scope was the surface added since the
2026-08-29 review (`research/security-review-2026-08-29.md`): the `/speed`
proxy, the `/system` page, the public demo stack, `tools/publish.sh`, the
CDN-apex guard in `kidnet-catmap` and the flush-and-refill in
`kidnet-catmeter`, plus a fresh look at `bin/kidnet` input validation, the
dashboard control API, the kid portal and the firewall itself.

Nothing was changed. No file was edited, no service restarted, no container
stopped, no host firewall rule touched. The one write was this file. Every
demonstration of a finding was done in a scratch copy under
`/tmp/claude-1000/.../scratchpad`, or against the public demo, or with
read-only queries. Reviewed at HEAD `3188b67`; note that the working tree was
being edited live during the review (twelve tracked files are modified,
`dashboard/server.mjs` among them), so the code quoted here is the committed
state.

## Summary

The new surface is, on the whole, better built than the old. The public demo is
genuinely inert and I could not find a way in: no docker socket, no `bin/`
mounted, no docker or psql or nft binary in the image, and its bridge network
cannot reach the shared Postgres or the gateway (all four probes timed out).
The `HEARTH_DEMO` guards are module-level constants read at import, nothing in
the tree writes `process.env`, and the flag is unset in every household process
and container on this box, so the portal's relaxed `?kid=` earning cannot apply
at home. The `/system` page is careful: I fetched both the HTML and the JSON
and found no MAC, no tailnet address, no IPv4 of any kind, no hostname, no
kernel interface name and no filesystem path. `/speed` is not the SSRF it looks
like, because the host and port are fixed. The one serious finding is not new
surface at all: `bin/kidnet` has four SQL interpolation sites with no
validation, and one of them is reachable over HTTP from the dashboard control
API and runs as the Postgres superuser on the shared production database. After
that the pattern that repeats is fail-open where the design promises fail-
closed: the publish scanner prints a clean board when two of its checks did not
run, `reconcile_set` cannot tell an empty query from a failed one, and the Tor
blocking set is empty on the live box with nothing anywhere saying so.

**FIXED on 2026-08-30: the serious finding in that paragraph is closed.** Every
interpolation site in `bin/` is gated, and nothing in `bin/` connects as the
superuser any more. See the note under C1 before quoting the sentence above.

## Severity count

- Critical: 1
- High: 3
- Medium: 6
- Low: 7
- Informational: 6

## The three that matter most

1. Critical: `POST /api/act` with `topsites` or `recent` puts attacker text
   straight into a SQL string in `bin/kidnet`, and `psql -tAc` runs multiple
   statements from one string, as `postgres` on the shared box.
   **FIXED on 2026-08-30, and so is the rest of C1: see the note there. The
   argument is gated, and the connection is no longer a superuser one.**
2. High: `tools/publish.sh` reported an all-green board on a test tree that
   held an SSID, a WAN address, a database password, an IPv6 tailnet address
   and a screenshot containing a child's name, a MAC and a tailnet address.
   Two of its checks had silently not run.
3. High: `kids_known` is fed by current DHCP leases, so a device with a new or
   spoofed MAC becomes "known" and gets full, unmetered, unblockable internet.
   The rule's own comment says it closes exactly that dodge.

---

## Critical

### C1. SQL injection across `bin/kidnet`, one path reachable over HTTP

> **FIXED on 2026-08-30. Closed in full, both halves.** Do not report any part
> of this as open without reading `bin/kidnet` and `config/db/grants.sql`
> first.
>
> - Fix 1 and 2 in the list below: done. Every argument in `bin/kidnet` that
>   reaches a SQL string now passes a gate, and so does every one in the
>   `bin/kidnet-*` workers. Fifty-five sites in all, including the ones this
>   report named (`assign`'s `$key` and `$rip`, `infra`'s `$key`) and the ones
>   it did not (all four values in `audit()`, the minutes and reason in
>   `addtime()`, the category in `setcat_id()`, and every child id read back
>   out of the database before it goes into a `WHERE`).
> - Fix 4, which this report correctly called the one that stays fixed: done.
>   `bin/kidnet` and every worker connect as **`kids_agent`**, not as the
>   Postgres superuser. `COPY ... TO PROGRAM` is refused for that role, and so
>   is reading a server file, dropping or truncating a table, deleting a child
>   or a day of history, and self-escalation. `kids_network` is also closed to
>   `PUBLIC`, so no other project's role on this shared server can open it.
> - Fix 3 (bound parameters instead of string building) was **not** done, and
>   the honest reason is that `psql -c` from a shell script has no good binding
>   story. The gates plus the role are the two layers standing in its place,
>   and both are tested rather than asserted.
>
> Proof, run on every change: `test/db-role-test.sh` fires this report's own
> payload (`1; COPY (SELECT 1) TO PROGRAM 'touch ...'; --`) at twenty-one
> `kidnet` verbs, requires each to refuse it before opening a connection, and
> then checks the file the payload would have created is absent. It also proves
> the role cannot do any of the things listed above. 77 checks, all passing.
> See DECISIONS.md, "The CLI stops being a superuser (2026-08-30)", and
> `docs/DATABASE.md`, "Roles".


**Files:** `bin/kidnet` lines 191 (already gated), 229 to 233 (`assign`), 240
(`infra`), 294 to 298 (`recent`), 299 to 304 (`topsites`).
**Reached from:** `dashboard/server.mjs` lines 340 to 356 (`POST /api/act`).

The `ck_name` / `ck_int` / `ck_text` gates exist, and the comment above them at
line 52 is exactly right about why: "The dashboard feeds this script over HTTP
and the bug bounty invites the kids to attack it." Four arguments never reach a
gate.

`topsites` and `recent` interpolate their LIMIT with no check at all:

```
recent) ck_name "${2:?kid}"; psqll "... ORDER BY l.ts DESC LIMIT ${3:-25}"
topsites) psqll "... ORDER BY count(*) DESC LIMIT ${2:-15}"
```

Both verbs are on the dashboard's allowlist. `/api/act` accepts `arg` as an
array, and `arg.map(String)` does not split on whitespace, so an array element
carries arbitrary text through to the command line. Confirmed against a
neutered copy of the script:

```
$ bash kidnet-dry topsites "15; COPY (SELECT 1) TO PROGRAM 'id'; --"
SQL>> ... ORDER BY count(*) DESC LIMIT 15; COPY (SELECT 1) TO PROGRAM 'id'; --
```

`psqll` is `docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"`.
Two things make that the whole game. First, `psql -tAc` executes a multi-
statement string: verified on this box with the harmless
`psql -tAc "SELECT 'stmt-one'; SELECT 'stmt-two'"`, which printed both. Second,
it connects as `postgres`, a superuser, which means `COPY ... TO PROGRAM` is
available and command execution inside the shared Postgres container follows.
I did not run that step.

`assign` and `infra` are worse in shape but only reachable from the command
line, which is to say from whatever the household's AI agent is told to do:

```
$ bash kidnet-dry assign "aa:'; UPDATE children SET policy_tier='adult'; --" Alice laptop
SQL>> WITH u AS (UPDATE devices SET child_id=1, label='laptop'
      WHERE mac::text='aa:'; UPDATE children SET policy_tier='adult'; --' ...
$ bash kidnet-dry infra "x'; DELETE FROM devices; --"
SQL>> UPDATE devices SET kind='ap', ... WHERE mac::text='x'; DELETE FROM devices; --'
```

The optional fifth argument to `assign` (`reserved_ip`) is unvalidated too and
lands in `SET ... reserved_ip='$rip'`.

**Concrete attack:** anything that can send one POST to the dashboard sends
`{"cmd":"topsites","arg":["1; <any SQL>; --"]}` and owns the database. The
only barrier is `DASH_TOKEN`, and see M1: the dashboard hands that token to any
unauthenticated GET. The dashboard's own callers are the browser and the agent,
so the realistic trigger is a stray device on the tailnet, a DNS rebinding page
opened on a tailnet device, or an agent that pastes a device label or a scan
result into a kidnet argument.

**Fix, in order:**
1. Gate the two reachable ones now: `ck_int "${3:-25}"` in `recent` and
   `ck_int "${2:-15}"` in `topsites`. That is a two-line change and it closes
   the HTTP path.
2. Add a MAC/IP gate for `assign` and `infra`
   (`[[ "$1" =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$|^[0-9.]{7,15}$ ]]`) and `ck_int`-
   style validation for `reserved_ip`.
3. The real fix is to stop string-building. `psqll` can take values through
   `psql -v` bindings or a here-doc with `\set`, so a bad argument becomes a
   bad value rather than a new statement. That is a bigger change but it is the
   only version of this that stays fixed.
4. Give the dashboard and the timers a non-superuser Postgres role. Nothing in
   Hearth needs `COPY ... TO PROGRAM`, and dropping superuser turns a database
   compromise back into a database compromise instead of a container one.

---

## High

### H1. `tools/publish.sh` prints a clean board when its checks did not run

**File:** `tools/publish.sh`, lines 22 to 26 (`scan`), 29, 50 to 68, 73 to 81.

Two of the checks are conditional on a value the script may not have, and when
they are skipped they print nothing at all, not even a line saying they were
skipped:

```
[ -n "${KIDS_NIC_MAC:-}" ] && scan "$KIDS_NIC_MAC" "adapter MAC"
NAMES=$(docker exec -i postgres psql ... 2>/dev/null)
[ -n "${NAMES:-}" ] && scan "\\b(${NAMES})\\b" "real people's names"
if [ -n "${AUTHOR:-}" ]; then ... fi
```

`fail` stays 0, so the script goes on to `git add -A`, commit and push. The
"real people's names" check is the most valuable one in the file, and it is the
one that depends on a docker exec succeeding.

I built a synthetic tree and ran the scanner's own lines 16 to 71 against it,
with the postgres container name changed so the lookup would fail the way it
would on a box where docker is down or the container was renamed:

```
Scanning for anything private...
  ok    real-looking MAC
  ok    real VPN address
  ok    inline password
  ok    bcrypt hash
  ok    GitHub token
  ok    private key
  ok    secrets.env            absent
  ok    config.env             absent
```

That tree contained, in tracked files: an SSID, a public WAN address, a LAN
range, an IPv6 tailnet address, `postgres://kids:hunter2horse@db:5432/...`,
`PGPASSWORD=correct-horse-battery`, an email address, and a binary
`shot.png` holding a child's name, a real-looking MAC and a tailnet address.
Every one of them shipped. Note the two missing rows: "real people's names" and
"author name placement" never printed, and nothing in the output says so.

The blind spots are four separate things and each deserves its own fix:

- **Silent skips.** A check that cannot run must be a failure, not a gap in the
  output.
- **`grep -riIlP`.** `-I` skips binary files. A dashboard screenshot, a PDF, a
  favicon, a `.db` file or a tarball is never looked at. Verified: `grep -I`
  skipped the PNG that `grep -a` found immediately. A screenshot of the
  Devices page is the single most likely way a real MAC and a real child's name
  reach a public repo.
- **Missing shapes.** There is no pattern for an SSID, a public IPv4, a LAN
  range, any IPv6 (so the whole `fd7a:115c:a1e0::/48` tailnet range is
  invisible), an email address, or a URL-embedded credential. The "inline
  password" regex requires a quote after the delimiter, so `PGPASSWORD=secret`
  and `postgres://user:pass@host` both pass. Only GitHub tokens are covered
  among API keys.
- **The public repo's own history.** The script scans the exported tree and
  then commits to a repo that keeps history forever. A value published once and
  removed next week stays in the public history, and nothing here looks.

**Fix:** make every check unconditional and make a skipped check exit 1 with a
named reason. Add `-a` (or a separate binary pass that greps with `-a` and
lists any file whose extension is not source or markdown, for a human to eyeball).
Add patterns for SSID (from `config.env`), public IPv4, IPv6 including the
Tailscale ULA prefix, `://[^/]*:[^@]*@`, `PGPASSWORD=`, `sk-`, `AKIA`, `xox[bp]-`
and an email regex. Finally, scan `git -C "$PUB" log -p` for the same patterns
once, not just the tree.

### H2. A device with an unrecognised MAC gets uncontrolled internet, and the ruleset says the opposite

**Files:** `config/nftables/kids.nft` lines 37 to 42 and 158;
`gateway/entrypoint.sh` lines 138 to 150.

The comment on the set is unambiguous:

```
# A device using any OTHER island address is unknown and gets no internet
# (only the portal). This is what closes the static-IP dodge
```

But `sync_state` fills `kids_known` from reservations **union current DHCP
leases**, plus every lease AdGuard is holding right now:

```
EXTRA_IPS="$(adguard_lease_ips)" \
reconcile_set kids_known "SELECT host(reserved_ip) FROM devices WHERE ... is_active
                          UNION SELECT host(ip) FROM dhcp_leases WHERE active"
```

So the way to become "known" is to ask for a DHCP lease, which every device on
the island does automatically. `kids_block`, by contrast, is built only from
`devices` joined to a child whose internet is off, so an unowned device can
never be in it. The result is that a child who is cut off changes their
device's MAC (a setting on every modern phone and laptop, and the point of MAC
randomisation), gets a fresh lease, lands in `kids_known`, is absent from
`kids_block`, has no reservation for the meter to attribute bytes to, and is
not a known AdGuard client so it gets the default DNS profile rather than their
age tier. Full, unmetered, unfiltered-to-their-tier internet.

On this box right now, read-only and counts only: `kids_known` holds 16
elements, `kids_block` holds 1, there are 14 active reservations, 13 active
DHCP leases and all 13 of those leases have no owning child.

This is not a regression. Before `kids_known` existed a MAC change dodged the
block in the same way. What is new is the claim that the dodge is closed, and
that claim is in the ruleset, in DECISIONS and in the prior review's addendum.
Under the project's own "never oversell" rule that is the defect.

**Fix:** either say what it does ("a device using an address that is not a
current lease or reservation gets no internet"), which is honest and still
useful, or make it true. Making it true means blocking by identity rather than
address: put an unowned lease in a `kids_unowned` set, drop its forwarded
traffic the way `kids_block` is dropped, and let the portal redirect explain
that the device needs adding. That converts a silent bypass into a captive
portal page, which is the behaviour the rest of the design already has.

### H3. `reconcile_set` cannot tell an empty result from a failed query, so a failure unblocks every child

**File:** `gateway/entrypoint.sh` lines 85 to 116, called at 147 to 149.

```
want=$( { timeout 10 psql "$DB" -tAc "$query" 2>/dev/null; ... } | grep -E '^[0-9]+[.]' | sort -u | paste -sd,)
if [ -z "$want" ] && ! timeout 5 psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  log "reconcile $setname: database unreachable, keeping the existing set"; return 0
fi
```

The exit status of the real query is thrown away inside the command
substitution and its stderr goes to `/dev/null`. The only fallback tests
whether the database is reachable at all. So if the `kids_block` query itself
fails while the server is up (a schema change, a permission error on
`category_state`, a lock, a ten second timeout on a busy shared box), `want` is
empty, `SELECT 1` succeeds, the guard does not fire, and the next line flushes
`kids_block` to nothing. Every blocked child is back online within fifteen
seconds, silently, with nothing logged and no alert raised.

The same code path is right for `kids_known`, where an empty set is fail-closed
and everybody loses internet. That is the tell: one reconciler is being used
for two sets whose safe defaults point in opposite directions.

**Fix:** capture the query's exit status separately and treat a non-zero status
as "keep the existing set", for both sets, and raise a `warn` alert when it
happens. Then add a per-set stance: `kids_block` keeps its contents on any
doubt, `kids_known` may empty. Do not swallow stderr; log the first line of it
the way the `nft -f` branch already does with `/tmp/nfterr`.

---

## Medium

### M1. `DASH_TOKEN` is handed to anyone who asks, so it does not do what its comment says

**File:** `dashboard/server.mjs` lines 41 to 45 and 493.

The comment says the token exists "so a stray device on the tailnet cannot
drive controls". But every page response sets it:

```
if (DASH_TOKEN) headers["set-cookie"] = `dash=${DASH_TOKEN}; Path=/; SameSite=Strict`;
```

with no authentication in front of it, and the cookie is deliberately not
HttpOnly so the page's own script can read it. Verified against the live
dashboard with an unauthenticated `curl -I /`, which returned the cookie.

So a stray device on the tailnet does one GET, reads the header, and drives
every control including C1. What the token genuinely does buy is cross-origin
protection: `SameSite=Strict` keeps a malicious website from riding along, and
without the token an ordinary `text/plain` POST from any site the parent visits
is a simple request that needs no CORS preflight, which is a working CSRF
against `/api/act`. That is real value and worth keeping. It is just not the
value the comment claims.

There is also no `Host` header check anywhere, so DNS rebinding defeats the
token completely: an attacker page whose domain resolves to the dashboard's
address becomes same-origin, reads `document.cookie`, and posts.

**Fix:** three small things. Correct the comment to say what the token is for.
Require the token on the page routes too, so it cannot be obtained without
already having it (a login page that sets the cookie once, or `Environment=` on
the operator's browser profile, or simply accept that the tailnet is the
perimeter and drop the pretence). And validate `Host` against an allowlist, which
costs three lines and closes rebinding regardless.

### M2. The token guard covers POST only, and two unauthenticated GET routes reach `docker exec ... nft`

**File:** `dashboard/server.mjs` lines 259 to 261 (the guard), 464 and 476 to
488 (the GET routes); `dashboard/live.mjs` lines 229 to 250.

The guard is:

```
if (req.method === "POST" && [...].includes(req.url) && !authed(req)) { 403 }
```

I checked every POST handler in the file against that list and all eleven are
covered, and a query string on the path 404s rather than slipping past, so no
mutating POST escapes. That part is sound.

What is not covered is GET. `/api/stream` and `/api/live.json` both start the
live wire, and `LiveWire.ensureTotals` runs `docker exec hearth-gw nft list
chain`, then `nft delete chain` and `nft -f -` if it judges the chain wrong.
That is an unauthenticated GET that shells out and rewrites a chain inside the
gateway's firewall. Verified: an unauthenticated GET to `/api/live.json`
returned 200 with 51 KB.

The chain in question (`livemetering`) is counting-only with policy accept, so
the blast radius today is small. The principle is not: the token is described
as covering "every /api/* call", and it covers rather less than that.

**Fix:** apply `authed()` to `/api/*` regardless of method, or at minimum to
the two that shell out. `/api/system.json` and `/api/system/stream` are pure
reads and can stay open if that is wanted.

### M3. `/speed` is an unauthenticated proxy to the island, and it amplifies

**File:** `dashboard/server.mjs` lines 168 to 232, routed at 247 to 249.

I could not turn this into an SSRF and I looked hard. `host` comes from
`docker inspect hearth-gw` or `SPEEDTEST_HOST`, `port` from `SPEEDTEST_PORT`,
and neither is request-controlled. The path is fully attacker-controlled but
Node rejects control characters in both the request target and header values at
parse time, so there is no request splitting, and `--path-as-is
/speed/../foo` simply 404s because the speed test normalises it. The
`docker inspect` call is `execFile` with a fixed argv and no shell.

What it is, is an unauthenticated pass-through of arbitrary methods, bodies and
headers to one fixed internal service, in front of the DASH_TOKEN guard by
design. Three consequences, all verified read-only against the live box:

- `POST /speed/upload` with a body returned `{"bytes":10}`. Arbitrary methods
  and bodies reach the island container from an unauthenticated request.
- `GET /speed/internet` returned `{"mbps":754.7,"bytes":25000000}`. One small
  request makes the gateway pull 25 MB from `speed.cloudflare.com`. There is no
  rate limit and no concurrency limit at either end. The same endpoint is
  reachable directly from the island on `:8877`, which `kids.nft` line 118
  accepts from every device including one in `kids_block`, so a child who has
  been cut off can still burn the household's data cap and saturate the uplink.
- `GET /speed/download` moved 4.2 GB in three seconds through the dashboard's
  Node process. That is a single-threaded event loop serving the parent's only
  control surface, and one unauthenticated request starves it.

Separately, `headers: { ...req.headers, host: ... }` forwards the browser's
`Cookie` header, and the dashboard sets its cookie with `Path=/`, so the
`DASH_TOKEN` value is sent to a container that lives on the island and answers
every device on it.

**Fix:** strip hop-by-hop and credential headers before forwarding (`cookie`,
`authorization`, `connection`, `upgrade`, `te`, `proxy-*`). Set a timeout on
the upstream request, which currently has none, so a hung upstream cannot pin a
connection open. Rate-limit `/internet` at the speed test itself (one in
flight, one per thirty seconds per source) and cap `/download` at a fixed size
rather than an endless stream. Consider whether `/speed` really needs to be
outside the token guard, given the parent reaching it is already on a page that
has the cookie.

### M4. The safety net is flushed and refilled in two commands, with no error handling

**File:** `gateway/entrypoint.sh` lines 155 to 172.

```
nft flush set inet kids kids_allow
nft add element inet kids kids_allow "{ $ips }"
```

Two separate transactions, and neither return value is checked. Between them
`@kids_allow` is empty, and the rule at `kids.nft` line 153 is what keeps 1737,
Youthline and Kidsline reachable for a child who is cut off, at bedtime, or out
of time. If the `add` fails for any reason the set stays empty until the next
hourly sync, and nothing alerts.

Every comparable place in the codebase already does this right. `reconcile_set`
in the same file pipes both commands into one `nft -f -`. The comment on
`tor_nodes` in `kids.nft` says "the whole set is flushed and refilled in one
transaction". `kidnet-catmeter` does the same. This is the one that was missed,
and it is the one the project's own iron rules single out as never to be
weakened.

**Fix:** use the same shape as `reconcile_set`:
`{ echo "flush set inet kids kids_allow"; [ -n "$ips" ] && echo "add element ..."; } | nft -f -`
and raise a `warn` alert if it returns non-zero.

### M5. A child on the island can poison or starve the category map

**Files:** `bin/kidnet-catmap` lines 87 to 111; `METERING.md` lines 111 to 145.

I found no injection here and I went looking for one. The TSV is written by
`csv.writer`, the address is validated by `ipaddress.ip_address` plus a
routability test, the category comes from a fixed six-value list in the SQL, so
nothing can escape the `COPY ... FROM STDIN` and nothing can escape the nft
`add element` in `kidnet-catmeter` (where the addresses come out of a Postgres
`inet` column and the flush plus fill is one atomic `nft -f -`). The CDN apex
guard reads correctly.

The problem is the input, not the parsing. `category_ips` is learned entirely
from what devices on the island choose to look up, and the ambiguity guard cuts
both ways:

```
if cat: cats_for.setdefault(ip,set()).add(cat)
else:   shared.add(ip)
...
DELETE FROM category_ips c USING _ci x WHERE x.category='!' AND c.ip=x.ip;
```

An address that answers for any uncategorised name in the scanned window is not
merely skipped, it is actively deleted from the meter. A child does not need to
control a domain to arrange that: a wildcard resolver such as `nip.io` or
`sslip.io` turns any address into an uncategorised hostname. Resolve
`<the-video-cdn-address>.nip.io` alongside their normal YouTube use and that
address leaves `video_ips` on the next tick and stops being metered. Repeat over
the handful of addresses they actually use and the per-category budget stops
counting them.

There is a blunter version. The scan reads `CATMAP_PAGES=15` pages of 100
querylog entries, so 1500 lookups. A device issuing random lookups at any rate
pushes every real query out of the window, and the meter learns nothing for the
whole household.

METERING.md's "Honest limits" section is good and covers a VPN, Shorts, YouTube
Music, and the shared front door problem. It does not cover a child
deliberately marking addresses as shared, or flooding the window. Those belong
there.

**Fix:** the cheap half is to stop deleting on a single window's evidence.
Require an address to look shared across N consecutive scans before it is
withdrawn, and keep a `withdrawn_ts` so a flapping address is visible. The
other half is to make the window time-based rather than count-based (scan
`older_than` back to the last run's timestamp, not fifteen pages), which
removes the flooding lever. Either way, add the two attacks to the honest
limits, because they are exactly the level-3 bug bounty material the project
invites.

### M6. The Tor layer is inert on the reference box and nothing says so

**Files:** `config/nftables/kids.nft` lines 69 to 81 and 160 to 177;
`deploy.sh` lines 77 and 93 to 102; `docs/tor-and-safety.md`.

Read-only element counts on the running gateway:

```
kids_known     16    kids_block      1    kids_allow    16
gaming_ips      3    video_ips       1    download_ips   0
tor_nodes       0
```

`tor_nodes` is empty, so all three Tor rules in the forward chain match
nothing. `kids-tor-sync.timer` is not in `/etc/systemd/system/` and
`systemctl is-enabled` returns `not-found`, although `deploy.sh` line 93 enables
it and `/usr/local/bin/kidnet-tor-sync` is installed. Five kids timers are
running where `deploy.sh` enables six.

The reason this is a security finding rather than a chore is that nothing
surfaces it. `test/firewall-test.sh` line 171 adds `203.0.113.9` to `tor_nodes`
itself and then asserts the rule works, which is the right way to test a rule
and tells you nothing about whether the set has any real content. The dashboard
shows no set sizes. So a documented control is entirely absent while the test
suite passes 100 percent and the System page is green. This project has already
been bitten twice by that exact shape (commits `1997b26` and `30f5be2`, "a
missing netcat made six isolation guarantees pass while testing nothing").

**Fix:** two things. Re-run the deploy step or install the timer so the set gets
filled. Then add a health assertion that is about content rather than rules:
`kidnet doctor` or `container-test.sh` should fail if `tor_nodes` or
`kids_allow` is empty on a box that has been up more than an hour, and the
System page should show each set's element count so an empty one is visible to
a parent.

---

## Low

### L1. The quiz mastery bonus still lands past the daily cap

`dashboard/portal.mjs` line 432. Unchanged from the prior review's L3:
`Math.min(quizMinutes(st, bank), capLeft) + (right === total ? MASTERY_BONUS : 0)`
adds the +5 after the clamp, so a perfect final round can push a day's quiz
earnings five minutes past `QUIZ_DAILY_CAP`. Bounded at +5 per day. Fix: clamp
the total including the bonus.

### L2. Portal GETs are unthrottled and each quiz page allocates an uncapped round

`dashboard/portal.mjs` lines 398 to 406, 446, 456 to 459. Unchanged from the
prior review's L2. The 1.5 second brake is on POST only and keyed by child, so
GET `/` runs six database queries per request and GET `/quiz/:bank` adds an
entry to `rounds` held for fifteen minutes with no per-child cap. Worth noting
that the portal's pool reaches the shared Postgres that other production
services on this box use, so the ceiling here is not just the portal. Fix: a
per-IP GET brake, a cap of a few live rounds per child, and a memory limit on
the portal container in `compose.yaml`.

### L3. Both servers return `e.message` to the client

`dashboard/portal.mjs` line 505 and `dashboard/server.mjs` line 574. Unchanged
from the prior review's L1. On the kid-facing portal this hands a bug-bounty
attacker Postgres column and query fragments. Fix: log server-side, return a
generic string.

### L4. No cap on SSE subscribers

`dashboard/sysmon.mjs` lines 412 to 441 and `dashboard/live.mjs` lines 422 to
445. Both add to an unbounded `Set`, and `sysmon.attach` also creates a 15
second heartbeat interval per connection. Six concurrent unauthenticated
streams were all served 200 with no throttling. Sockets and timers are the
limit. Fix: cap the set, refuse past it with 503, and use one shared heartbeat
timer rather than one per client.

### L5. `/speed/info` discloses container identity and the docker bridge address

Reached unauthenticated through the proxy; `speedtest/server.mjs` lines 419 to
425 return `hostname()` (the container id) and the client address as the
gateway sees it (the dashboard host's address on the docker bridge). Nothing
household-identifying, but it is internal topology handed out with no auth, on
the one route deliberately outside the guard. Fix: drop `serverHost` or replace
it with a fixed label.

### L6. `LABEL_RE` accepts apostrophes that `ck_text` refuses

`dashboard/server.mjs` line 96 allows `'` and `’` in a device label;
`bin/kidnet` line 57 `ck_text` does not. So renaming a device to "Mum's iPad"
works while it has no owner (that path is parameterised) and fails with a
`kidnet: bad text` the moment it does, surfaced to the parent as the word
"assigned". Not a vulnerability, but the two gates are meant to be the same gate
and the comment at line 92 says so. Fix: align them, and prefer widening
`ck_text` only if the SQL it feeds is parameterised first.

### L7. Five POST handlers read the body with no size cap

`dashboard/server.mjs` lines 263, 270, 288, 300 and 341 accumulate with
`req.on("data", c => b += c)` and no limit, while `readJson` at line 86 caps at
64 KB and the portal caps at 10 KB. Tailnet-only and operator-facing, so low,
but there is no reason for the two shapes to differ. Fix: route all five
through `readJson`.

---

## Informational

### I1. The AdGuard credential in history is not in the public clone

The prior review's C1 said the hashes in `config/adguard/AdGuardHome.yaml`'s
history would reach anyone who cloned the published repo, and
`docs/GO-PUBLIC-CHECKLIST.md` line 42 now says it is "urgent rather than
blocking, because the history is public". That reads worse than it is.
`tools/publish.sh` builds the public repo with `git archive HEAD | tar x`, into
a separate git history that has never contained this repo's commits. Eleven
bcrypt hashes are reachable in this working repo's history and zero are in any
tracked file at HEAD. So the exposure is local, not published. That is worth
correcting in the checklist, because the current wording will make somebody
rewrite history under time pressure when the actual outstanding item is
narrower: rotate the live AdGuard password away from a value that is known to
anyone who has read this repo's history on this box. That is still worth doing.

### I2. The dashboard can drive docker, so any code execution in it is root on the box

`dashboard/sysmon.mjs` line 41 opens `/var/run/docker.sock` and
`dashboard/server.mjs` line 175 runs `docker inspect`. Access to the docker
socket is root-equivalent. Combined with an unauthenticated HTTP surface and
C1, the realistic worst case for the dashboard is not "a parent control gets
misused", it is the whole machine, which on this box also runs unrelated
production containers. Worth stating plainly in the threat model rather than
treating the dashboard as a low-value target.

### I3. The demo's public token means the demo database can be defaced

`demo/compose.yaml` line 59 sets `DASH_TOKEN: hearth-demo`, which is in a public
repo, and the demo's `/api/child`, `/api/goal`, `/api/tier`, `/api/device`,
`/api/task`, `/api/quiz` and `/api/household` write directly to Postgres without
going through the `HEARTH_DEMO`-guarded `runKidnet`. A visitor can delete the
demo's children. `demo/reseed.sh` runs nightly so the damage is bounded to a
day, and the database is invented. Noted so nobody is surprised, not as a
defect. If it matters, run the demo read-only by refusing writes when
`HEARTH_DEMO` is set, the way the shell-out paths already are.

### I4. Prior-review items still open

`M1` (an `nft -f` failure now deletes the working `inet kids` table and leaves
kids0 up at the gateway address with `ip_forward` on for the 30 second retry
gap: `gateway/entrypoint.sh` lines 69 to 70 and 190 to 191) and `M2` (the input
chain's first substantive rule is `iifname != $KIDS_IF accept`, so AdGuard :53,
AdGuard :3000, the portal :80 and the speed test :8877 are all open to the
docker network behind eth0) are both unchanged. `L1`, `L2`, `L3`, `L5` and `L6`
are unchanged and appear above. `H1`, `M3` and `M4` from that review are fixed
and I verified the fixes.

### I5. `bin/kidnet-quiz`, `kidnet-report`, `kidnet-classify`, `kidnet-servicemeter`, `kidnet-iot-policy`

I read the interpolation sites in these and found nothing reachable. `kidnet-quiz`
gates with `ck_id` and `ck_name`, `kidnet-report` gates with `ck_name`,
`kidnet-classify` and `kidnet-servicemeter` interpolate values that came out of
the database or out of nft's own JSON, and `kidnet-iot-policy` scrubs with
`tr -cd` before interpolating. They are string-built rather than parameterised,
so they share C1's fragility, but I could not find an untrusted value reaching
any of them today.

### I6. The working tree was being edited during this review

Twelve tracked files are modified against HEAD `3188b67`, including
`dashboard/server.mjs`. The change I saw to that file was to its header
comment. Recorded so the report is not read as describing something it did not
look at.

---

## What I checked and found nothing wrong with

These held up. Several of them are the answers to the questions this review was
asked, so the negatives are the finding.

- **The demo cannot reach anything real, and I tested it rather than reading
  it.** `hearth-demo-dashboard` and `hearth-demo-portal` are on the
  `hearth-demo` bridge only. TCP probes from inside the demo dashboard to the
  shared Postgres (`172.18.0.1:5432`, `172.18.0.2:5432`), to the gateway's speed
  test (`172.18.0.3:8877`) and to the default bridge (`172.17.0.1:5432`) all
  timed out, which is docker's inter-bridge isolation doing its job. There is no
  `/var/run/docker.sock`. The only mounts are `dashboard/` and `portal/quizzes/`,
  both read-only, so `bin/` is not present and `KIDNET` points at a path that
  does not exist in the container. `which docker psql nft` finds none of them.
  `POST /api/act` with the public token returned the demo no-op string rather
  than any kidnet output. `/api/system.json` returned `"demo":true` with
  invented figures and a made-up container list. `/speed` returned the static
  explanation page.

- **`HEARTH_DEMO` cannot be flipped by a request.** Every consumer reads
  `process.env.HEARTH_DEMO === "1"` once, at module load, into a `const`. The
  only writes to `process.env` anywhere in the tree are inside the `pg`
  dependency. It is set only in `demo/compose.yaml` and I confirmed it is unset
  in every Hearth process and every Hearth container on this box:
  `hearth-portal`, `hearth-gw`, `hearth-speedtest`, `hearth-adguard`, the
  dashboard, and the host copy of the portal. So the `?kid=` earning relaxation
  in `dashboard/portal.mjs` line 457 cannot apply at home. That is the right
  design: the flag opens the gate, and the gate is a compile-time constant in a
  process whose environment nothing in the request path can touch.

- **The `/system` page does not leak the household.** I fetched `/system` and
  `/api/system.json` from the live dashboard and grepped both. Zero MAC-shaped
  strings, zero addresses in `100.64.0.0/10`, zero IPv4 addresses of any kind,
  zero occurrences of the hostname, zero kernel interface names, zero `/srv` or
  `/home` paths. `physicalIfaces` deliberately relabels to "Wired to the router"
  and "Wi-Fi" and never emits `i.name`, and the `device/uevent` test excludes
  the VPN interface without having to name it, which is a nice piece of design.
  Container names are disclosed (`hearth-gw`, `hearth-adguard`, `hearth-portal`,
  `hearth-speedtest`) and that is the point of the tile.

- **No command injection in any docker call.** Every one is `execFile` with an
  array argv and no shell: `docker inspect hearth-gw -f ...` in `server.mjs`,
  `docker exec hearth-gw nft ...` in `live.mjs`, and `runKidnet` /`runTool`
  spawn `bash` with the script path as `argv[1]` rather than as a command
  string. `sysmon.mjs` does not shell out at all, it talks to the docker socket
  over HTTP. The verb is allowlisted before `runKidnet` is called.

- **No mutating POST escapes the token guard.** I enumerated all eleven POST
  handlers in `server.mjs` against the eleven entries in the guard list and they
  match exactly. Appending a query string does not slip past: the guard misses
  it but so does the handler, and the request falls through to a 404, which I
  confirmed against the demo.

- **No injection in the new nft set handling.** In `kidnet-catmap` both TSV
  fields are constrained (validated IPv4, and a category from a six-value SQL
  `IN` list), so nothing can escape `COPY ... FROM STDIN` or reach the `\.`
  terminator. In `kidnet-catmeter` the addresses come from `host(ip)` on a
  Postgres `inet` column and are filtered again with `grep -E '^[0-9]'`, and the
  flush plus fill go into a single `nft -f -` so a failed add rolls back rather
  than leaving the set empty. A hostile DNS answer cannot produce a value that
  nft would parse as anything but an address. The CDN apex guard's `i==0` test
  is correct: it fires only when the queried name is the apex itself.

- **The portal's SQL is fully parameterised, and so is the dashboard's.** Every
  query in `portal.mjs`, `earn.mjs`, `household.mjs` and the `/api/*` handlers
  in `server.mjs` binds through `$1`. The child never touches `bin/kidnet`, so
  C1 is not kid-reachable.

- **A child cannot credit themselves minutes they did not earn, or act as
  another child.** Round tokens are 16 random bytes; `gradeRound` checks
  `round.childId !== kid.id` and deletes the round synchronously before any
  `await`, so a double submit cannot double credit; the cooldown and the daily
  cap are read from the database at grade time, not carried in the round; the
  answer key never leaves the server, even on a wrong answer; the choice order is
  shuffled per round and the index stored server-side. The `/claim` path resolves
  the task through `task_offer_effective` scoped to the child, and the "one claim
  per job per day" is enforced by a `WHERE NOT EXISTS` in the insert rather than
  by the client. The `?kid=` override is refused for every POST unless the source
  IP maps to a real reservation. L1 is the only way past the cap and it is worth
  five minutes.

- **The firewall's core guarantees read correctly.** Isolation is first and
  unconditional in the forward chain and `$PRIVATE` covers the main LAN, both
  docker ranges and the Tailscale CGNAT range. Forwarded IPv6 is dropped
  outright, which closes the prior review's M4. `@kids_allow` sits above both the
  `kids_known` drop and the `kids_block` rules, so the help lines survive a cut,
  bedtime, out-of-time and an unrecognised device, and the comment at line 183
  explaining why there is no `daddr @kids_block` rule is exactly right. Plain :53
  is DNAT'd both protocols, :853 is rejected, the DoH address set is rejected on
  :443, and the input chain drops everything from the island except DHCP, DNS and
  the portal pinned to the gateway address, the speed test, and ICMP echo. The
  NAT masquerade names no interface, which is why the file is portable.

- **The segment guard still fails closed with positive proof.** It treats only
  tcpdump rc 124 together with a confirmed "listening on kids0" as quiet, and any
  other outcome, including one where it could not listen at all, refuses to bring
  the island up. That is the corrected version of the silent-failure bug and it
  still reads correctly.

- **Secrets hygiene at HEAD.** No bcrypt hash in any tracked file.
  `secrets.env` and `config.env` are gitignored and untracked, only the
  `.example` files are tracked, and `publish.sh` refuses if either appears in the
  export. The problem is history and the scanner's gaps, not the current tree.
