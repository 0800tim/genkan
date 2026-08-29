# HEARTH security review, 2026-08-29

Adversarial, read-only audit of the self-hosted parental-control gateway at
`/srv/projects/internal/kids-network`. No files were changed, no containers or
services were restarted, deploy.sh was not run. Findings were checked against
the running stack (hearth-gw, hearth-portal, hearth-adguard) with read-only
commands and against the tracked source at HEAD `4b5f506`.

## Severity count

- Critical: 1
- High: 1
- Medium: 4
- Low: 6

## Top 5, one line each

1. Critical: the live AdGuard admin password `<the dev password>` is recoverable from
   git history (committed bcrypt hash), and the repo is slated to be published.
2. High: the portal `?kid=` override lets any island device act as any child
   (view status, claim chores, earn quiz minutes under a sibling's identity).
3. Medium: on an nft reload failure the gateway leaves an empty ruleset and a
   half-up island, so the isolation and DNS-forcing guarantees drop out.
4. Medium: services in the gateway namespace (AdGuard 3000/53, portal 80) are
   open to the postgres docker network and to host loopback, not just kids0.
5. Medium: `kidnet earn` interpolates an unmatched task string straight into a
   SQL arithmetic expression, an injection reachable from the dashboard.

---

## Critical

### C1. AdGuard admin credentials live in git history; the repo is meant to go public

**File:** `config/adguard/AdGuardHome.yaml` (history, not HEAD).
**Commits:** `a401da3` introduced the hash for password `change-me-on-deploy`;
`a522f1d` introduced the hash for password `<the dev password>`; `4b5f506` replaced it
with the `REPLACE_AT_DEPLOY_WITH_BCRYPT_HASH` placeholder.

HEAD is clean: the tracked file carries only the placeholder, and deploy.sh
generates a real random password at first deploy. That is good. The problem is
git history. Two real bcrypt hashes remain reachable to anyone who clones the
repo:

- `$2b$10$<redacted-see-SECURITY.md>` = `change-me-on-deploy`
- `$2b$10$<redacted-see-SECURITY.md>` = `<the dev password>`

Both were cracked offline in under a second during this review (they are weak,
guessable strings). The second is the dev password the task flagged, and it is
still live: `curl -u admin:<dev-password> http://127.0.0.1:8853/control/status`
returns HTTP 200 against the running hearth-adguard right now, while a wrong
password returns 401. So the credential to the box that does all the DNS
filtering is sitting in the history of a repo the project plans to open-source
and push to GitHub as 0800tim.

AdGuard admin access means: turn off all filtering, change upstreams, add
DNS rewrites, read every child's full per-device DNS query log. The nft input
chain does stop a kid on kids0 from reaching :3000 (see S1), so this is not a
kids-network bypass on its own. The exposure is publication plus any path to
the admin port (host loopback, the docker network, the tailnet via the host).

**Concrete attack:** the repo is published; anyone runs `git log -p` on
`config/adguard/AdGuardHome.yaml`, extracts the hash, cracks `<the dev password>` in
milliseconds, and now holds the admin password of the running filter. If Tim
reuses that password anywhere else, it spreads.

**Fix:**
1. Rotate the live AdGuard password now (it is a known value regardless of
   publication). Set a real random one and store it only in `secrets.env`.
2. Before any public push, rewrite history to purge both hashes, for example
   `git filter-repo --path config/adguard/AdGuardHome.yaml --invert-paths` for
   the offending revisions, or a targeted `filter-repo --replace-text`. A force
   push and fresh clones follow. Confirm with
   `git log -p --all -- config/adguard/AdGuardHome.yaml` showing no hash.
3. Add a pre-publish check (grep history for `$2a$`, `$2b$`, `$2y$`) to the
   release checklist so this cannot recur.

---

## High

### H1. The portal `?kid=` override is an unauthenticated identity switch

**File:** `dashboard/portal.mjs`, lines 46 to 48 (`whoIs`), 197 to 199 (request
handling), and every page/action that trusts `kid.id`.

The portal identifies a child by the source IP mapped to a DHCP reservation
(`whoIs` by `host(d.reserved_ip)=$1`). But if the request carries `?kid=NAME`,
`whoIs` ignores the IP entirely and looks the child up by name:

```
if (override) return q("SELECT id,name,age FROM children WHERE lower(name)=lower($1)", [override]);
```

There is no check that the requesting device belongs to that child, and no
auth of any kind on the portal (by design, it is the captive page). So any
device on the kids island, recognised or not, can become any child by adding
a query string. With that identity it can:

- read another child's status: remaining minutes, which categories are
  blocked, pending chore claims (privacy break across siblings);
- submit chore claims as another child (`/claim`), flooding Dad's approval
  queue or claiming chores in a sibling's name;
- run quizzes and bank the earned minutes onto another child's clock
  (`/quiz/submit` credits `round.childId`, which is set from the override).

This is exactly the "can a kid impersonate another kid or check another kid's
status" case in the threat model, and the answer is yes, trivially, from a
browser address bar. It does not directly grant the attacker extra screen time
for their own device (credit lands on the named child, and the quiz cooldown
and daily cap still apply per child), so it is not privilege escalation to free
time. The blast radius is impersonation, cross-child privacy, and griefing of
the parent-approval workflow, which is why it is High rather than Critical.

Note that the underlying IP-trust model is itself soft: a kid who sets a static
IP equal to a sibling's reservation impersonates them even without `?kid`
(this is acknowledged as bug-bounty level 3). The `?kid` override removes even
that small effort.

**Fix:** treat `?kid` as a parent-only convenience, not a child-facing one.
Options, in order of strength:
- Drop `?kid` from the portal entirely and always derive identity from the IP
  reservation. If a device is unknown, show the "ask Dad" page (already there).
- If a manual override is genuinely wanted for testing, gate it behind a check
  that the override name matches the child the source IP already resolves to,
  or behind a shared secret only the operator has.
- Separately, log every `?kid` use to `block_events`/`alerts` so impersonation
  attempts are visible.

---

## Medium

### M1. nft reload failure leaves an empty ruleset and a half-up island

**File:** `gateway/entrypoint.sh`, `load_firewall` (lines 53 to 57) and the main
loop (lines 114 to 122).

`load_firewall` runs `nft flush ruleset` and then `nft -f /etc/kids.nft`. If the
second command fails at runtime, the flush has already committed, so the
namespace is left with an empty ruleset: policy accept on every chain, no
isolation rule, no DNS forcing, no DoH/DoT block, no NAT. The entrypoint returns
1 and loops, but it does so after already having run `ip addr replace` (line
117), so kids0 is up with 192.168.60.1 and `ip_forward` is 1 while the ruleset
is empty, for the 30 second retry gap and every gap after if the failure
persists.

Practical impact is bounded by the fact that the NAT masquerade rule is in the
same file, so with the ruleset empty there is no masquerade and a kid's private
source address gets no usable return path to the internet or to the postgres
container. So this reads more as denial than a clean bypass. But the stated
guarantee is fail-closed, and this is a fail-open-ish state: forwarding is on
with zero policy, DNS is no longer forced, and the design relies on the ruleset
always being present. The deploy-time `nft -c` check makes a runtime parse
failure unlikely, which keeps this at Medium, but "unlikely" is not the
guarantee the docs make.

**Fix:** make the failure path truly closed. On any `load_firewall` failure,
bring the island interface down (`ip link set kids0 down`) before sleeping, so
there is no half-up island. Alternatively load a tiny default-drop ruleset
first (drop forward, drop input from kids0) and only then apply the full file,
so a failed apply degrades to closed rather than to open.

### M2. In-namespace services are reachable off the island, not only from kids0

**Files:** `config/nftables/kids.nft` input chain (lines 55 to 75);
`compose.yaml` (gateway `ports: 127.0.0.1:8853:3000`, networks `postgres`).

The gateway container sits on the external `postgres` docker network via eth0
(verified: eth0 is 172.18.0.3/16, postgres is 172.18.0.2 on the same net). The
portal and AdGuard share this namespace, binding 0.0.0.0. The nft input chain
polices only kids0:

```
iifname != $KIDS_IF accept        # first substantive rule
```

Everything arriving on eth0 is accepted. So AdGuard :53, AdGuard admin :3000,
and the portal :80 are reachable from the 172.18.0.0/16 docker network (the
postgres container, and anything else later attached to that network), and the
admin UI is additionally published to host loopback on 127.0.0.1:8853. The
kids0 side is correctly locked down, so this is not a determined-teen path; it
is a lateral one. Combined with C1 (a known admin password), any process on the
host or any container on the postgres network can administer the filter.

**Fix:** bind the services narrowly, or police eth0 too. Either bind AdGuard's
web UI and the portal to 192.168.60.1 instead of 0.0.0.0, or add input rules
that only accept 53/80/3000 on the kids0-facing address and drop those ports on
eth0. Reconsider whether the admin UI needs to be published to host loopback at
all; reaching it over the tailnet via an explicit SSH tunnel is safer than a
standing 127.0.0.1 listener. And once C1 is fixed the password is at least no
longer a known value.

### M3. SQL arithmetic injection in `kidnet earn`

**File:** `bin/kidnet`, `earn` case (line 113) and `addtime` (lines 103 to 104).

```
earn) cid=$(tid "${2:?kid}"); ck_text "${3:?task}";
      mins=$(psqll "SELECT minutes FROM tasks WHERE name ILIKE '%${3}%' LIMIT 1");
      mins=${mins:-$3}; addtime "$cid" "$mins" earn "task:${3}"; ...
```

When the task text matches no row, `mins` defaults to the raw task string `$3`.
`addtime` then interpolates it unquoted into arithmetic:

```
UPDATE time_ledger SET bonus_min=bonus_min+$2 WHERE ...
```

`ck_text` allows `[A-Za-z0-9_:+.,\ -]`, which includes the comma. A task value
such as `0,used_min=0` turns the statement into
`SET bonus_min=bonus_min+0,used_min=0 WHERE ...`, resetting the meter and
handing back time, and other columns can be reached the same way. Single quotes
and semicolons are blocked by `ck_text`, so this is constrained to the current
UPDATE, not arbitrary statements, but it is still an injection that can grant
screen time.

Reachability: the `earn` verb is driven by the dashboard (`/api/act` and the
claim-approval path). The dashboard is tailnet-only and unauthenticated (S2),
so this is operator-adjacent rather than kid-reachable today. It is defence in
depth that should not be left standing, since the whole point of the `ck_*`
gates is that kidnet is a bug-bounty target.

**Fix:** never fall back to interpolating the task text as a number. Require the
minutes to be a resolved integer: if the task lookup misses, either reject, or
validate `$3` with `ck_int` before using it as minutes. Better still, parameterise
the psql calls (pass values with `psql -v` or via `$1` bindings) rather than
string-building, across kidnet.

### M4. IPv6 is entirely unfiltered by the ruleset

**File:** `config/nftables/kids.nft` (all rules use `ip`, none use `ip6`).

The table is `inet` (both families) but every rule matches `ip saddr`/`ip daddr`
and the `PRIVATE` set is IPv4 only. There are no `ip6` rules and no icmpv6
handling. That means if the island ever carries IPv6, none of the guarantees
apply to it: DNS forcing (the dnat is `dnat ip to`), the DoT reject, the DoH IP
block, the `kids_block` cutoff, and the isolation drop are all IPv4-only. A kid
with IPv6 could use an IPv6 DoH resolver, and IPv6 tailnet or LAN addresses
(Tailscale uses `fd7a:115c:a1e0::/48` and IPv6 CGNAT) would not be caught by the
IPv4 `PRIVATE` set.

Right now this is latent, not live: the running gateway has no IPv6 address
beyond loopback, no IPv6 default route, eth0 is IPv4-only, and nothing hands out
IPv6 on kids0. So today it is not exploitable, which is why it is Medium and not
High. But it is a silent fail-open the moment IPv6 appears, whether from a docker
daemon setting, an upstream router advertisement reaching the segment, or a
future change. A control that silently stops applying is exactly the class of
bug the project's own history warns about.

**Fix:** make the IPv6 stance explicit rather than accidental. Either disable
IPv6 in the container namespace (sysctl `net.ipv6.conf.all.disable_ipv6=1`, and
do not advertise IPv6 on kids0), or add mirror `ip6` rules: drop forward to
IPv6 ULA/link-local/private and tailnet ranges, redirect or reject IPv6 :53,
reject IPv6 DoT/DoH. Add an IPv6 assertion to `firewall-test.sh` so it stays
enforced.

---

## Low

### L1. Error messages leak internals to the kid

`dashboard/portal.mjs` line 222 returns `"portal error: " + e.message`, and
`dashboard/server.mjs` line 148 returns `"error: " + e.message`. A Postgres or
runtime error message (column names, query fragments) is handed to the client.
On the kid-facing portal this is information disclosure that helps a bug-bounty
attacker map the schema. Fix: log the detail server-side, return a generic
message to the client.

### L2. No rate limit on portal GET; unbounded in-memory rounds

`dashboard/portal.mjs`: the 1.5s throttle (`lastPost`, line 203) covers POST
only. GET `/` runs five DB queries via `status()` each time, and GET
`/quiz/:bank` creates a fresh `rounds` entry (line 155) held for 15 minutes.
A kid scripting rapid GETs can load the database and grow the `rounds` map;
the node:22-slim portal has no memory limit set in compose.yaml. Impact is a
local portal or DB denial, not a filtering bypass. Fix: add a per-IP GET brake,
cap the number of live rounds per child, and set a container memory limit.

### L3. Quiz daily cap can be exceeded by the mastery bonus

`dashboard/portal.mjs` line 180: credited minutes are
`Math.min(minutes_per_pass, capLeft) + (perfect ? MASTERY_BONUS : 0)`. The +5
mastery bonus is added after the cap clamp, so a perfect final round can push a
day's quiz earnings up to 5 minutes past `QUIZ_DAILY_CAP`. Small, but it is a
way to beat the stated cap. Fix: clamp the total, bonus included, to `capLeft`.

### L4. Dashboard has no request body size limit

`dashboard/server.mjs` lines 125 and 138 accumulate the POST body with no size
guard (the portal correctly caps at 10 KB). The dashboard is tailnet-only and
operator-facing, so this is low, but a large body would be buffered whole. Fix:
cap and destroy past a small limit, as the portal does.

### L5. Dashboard has no authentication (by design); the isolation is the only wall

`dashboard/server.mjs` binds the tailnet with no auth. This is the documented
design (tailnet is the trust boundary). It holds only as long as segment
isolation holds and the tailnet is not joined by an untrusted device. That is a
reasonable posture for a household tool, and the isolation rules do block the
100.64.0.0/10 CGNAT range so a kid cannot reach the tailnet from the island.
Worth stating the residual: anyone who gets onto the tailnet (a lost phone, a
shared node, a future guest node) gets full control with no second factor, and
every control the dashboard exposes writes state or runs kidnet. Consider a
single shared secret or a bound-to-one-identity check before this is handed to
other households whose tailnets you do not control. Left as Low because it
matches the stated design and the IPv4 isolation for the tailnet range checks
out.

### L6. IP-trust device identity (bug-bounty level 3, acknowledged)

`whoIs` maps source IP to a child. A kid who sets a static IP equal to a
sibling's reservation is that sibling to the portal, and a kid who sets an
unreserved static IP is unknown and simply sees "ask Dad". This is called out
in BUG-BOUNTY.md as a level-3 target and is inherent to a portal that cannot
authenticate a device. Noted for completeness, not as a new defect. Fixing H1
removes the easier `?kid` version of the same impersonation.

---

## What I checked and found solid

These held up under scrutiny and are worth trusting:

- **Namespace isolation is real, not trust-based.** Verified on the running
  stack: hearth-gw runs with `CapDrop=[ALL]`, `CapAdd=[NET_ADMIN, NET_RAW]`,
  `Privileged=false`, and its only interfaces are eth0 and lo (kids0 is handed
  in at runtime). Portal and AdGuard join with `network_mode: service:gateway`
  and add no extra network caps beyond what DHCP needs. Nothing uses host
  networking. A bad rule or a crash degrades the island, not the house. This is
  the strongest part of the design and it checks out.

- **Isolation rule ordering is correct.** In the forward chain
  (`config/nftables/kids.nft` lines 77 to 103) the `ip daddr $PRIVATE drop`
  is first and unconditional, and `$PRIVATE` includes 192.168.0.0/16,
  172.16.0.0/12, 10.0.0.0/8 and the 100.64.0.0/10 tailnet CGNAT range. Nothing
  below can grant isolation away. The main LAN, the docker networks and the
  tailnet are all covered on IPv4.

- **DNS forcing and the DoH/DoT blocks are present and ordered sanely.** Plain
  :53 (tcp and udp) is dnat'd to the gateway even if a device hardcodes 8.8.8.8;
  :853 DoT is rejected; a set of known public DoH resolver IPs is rejected on
  :443. The honest limits (IP-based DoH block covers the easy 90%, not a
  determined bypass) are documented rather than oversold.

- **The safety net is correctly built and genuinely fail-safe.** `@kids_allow`
  sits above the block rules, so scope='safety' domains (1737, Youthline,
  Kidsline, schoolwork) stay reachable through a cut, dinner, bedtime and
  out-of-time. The scope split (schema-safety.sql) keeps Spotify at
  scope='category' so audio does not punch through a full cut, and new rows
  default to the cautious 'category'. Both `kidnet allow-sync` and the container
  `sync_safety_net` refuse to empty the set on a resolver blip (they keep the
  stale set rather than leaving a kid unable to reach a help line). This is the
  kind of fail-safe the docs promise, and the code matches.

- **The kid-facing portal has no SQL injection.** Every query in portal.mjs is
  parameterised through pg ($1, $2). `whoIs`, `status`, `credit`, `ensureDay`
  and the claim insert all bind values. The kid touches only the portal, never
  kidnet, so the kidnet interpolation risks (M3) are not kid-reachable.

- **Portal output is escaped and quiz answers stay server-side.** `esc()` covers
  `& < > "` on all dynamic output; the `?kid` value is placed only through
  `encodeURIComponent`; quiz content comes from trusted static JSON. Answer keys
  live in the in-memory `rounds` map and are never sent to the client, even on a
  wrong answer.

- **The quiz round scheme resists the obvious gaming.** Tokens are 16 random
  bytes; a round is graded once and deleted synchronously before any await, so a
  double-submit race cannot double-credit; per-bank cooldown and the daily cap
  are read from the database at grade time; the per-child POST throttle
  serialises a single child's submits. The 30-minute daily cap holds apart from
  the small L3 mastery overrun. A kid cannot bank more than the intended
  quiz time.

- **kidnet input gates and the dashboard shell boundary.** `ck_name`, `ck_int`
  and `ck_text` reject quotes and semicolons, so the common name and number
  paths cannot break out of their SQL strings, and `ips_for` is only reached
  after `setcat` has run `ck_name`. The dashboard calls kidnet via
  `execFile("bash", [KIDNET, ...args])` with an array, so there is no shell to
  inject into, and the verb is whitelisted before the call. M3 is the one gap
  in this otherwise sound gate.

- **Earned unblock is correctly scoped.** `credit()` in portal.mjs and the
  `bonus`/`earn` paths in kidnet only clear internet blocks whose `set_by` is
  in ('out-of-time','earned-back') and only when remaining time is positive. A
  parent block (`set_by='agent'`, dinner, discipline) is never lifted by a kid
  earning, which matches the stated decision that the kid cannot overrule the
  parent.

- **The segment guard fails closed with positive proof.** It treats only
  tcpdump rc 124 plus a confirmed "listening on kids0" as "quiet"; any other
  outcome, including a guard that could not listen, refuses to start the island.
  This is the corrected version of the silent-failure bug the decision log
  describes, and it reads correctly.

- **Secrets hygiene at HEAD is right.** `secrets.env` and `config.env` are
  gitignored and not tracked (only the `.example` files are). The tracked
  AdGuardHome.yaml carries a placeholder, not a hash. deploy.sh generates a
  random AdGuard password and validates the ruleset with `nft -c` before
  building. The only secrets defect is C1, which is entirely in history.

- **The kids-side firewall does hide the AdGuard admin port.** The input chain
  drops everything from kids0 except DHCP, DNS to the gateway, the portal on :80
  and icmp echo. A kid on the island cannot reach :3000, so C1 is a publication
  and lateral-access problem, not a direct kids-network compromise.

---

## Addendum: concurrent fixes observed during the review

While this review was being written, the working tree was being edited live (a
tmux Claude session). HEAD is still `4b5f506`, so the findings above describe the
committed state, but the uncommitted working tree already addresses several of
them. Recorded here so the report is not read as stale.

- **H1 (?kid override):** substantially fixed in `dashboard/portal.mjs`. `whoIs`
  now returns a `real` flag; the override is honoured only when the source IP
  maps to no child, and POSTs are rejected unless `kid.real` is true. A
  recognised kid can no longer act or peek as a sibling. Residual (low): an
  unregistered device on the island can still GET another child's status by
  name (`?kid=`), a read-only information leak. Consider dropping the override
  entirely or gating it behind an operator secret.

- **M3 (kidnet earn injection):** fixed. `bin/kidnet` now runs `ck_int "$mins"`
  on the fallback before interpolating, so a non-numeric task string can no
  longer reach the SQL arithmetic. Parameterising psql calls is still the
  stronger long-term fix.

- **M4 (IPv6 unfiltered):** largely fixed. `config/nftables/kids.nft` now drops
  forwarded IPv6 from the island (`meta nfproto ipv6 drop`) above the accept
  paths, so a future v6 uplink or rogue RA cannot sail past the IPv4 rules.
  Input and prerouting remain IPv4-only, which is fine as long as the gateway
  binds no IPv6 services (it currently binds none).

- **L6 / static-IP dodge:** a new `kids_known` set plus
  `ip saddr != @kids_known drop` and a portal redirect for unknown sources is
  being added, which would close the static-IP impersonation path.

  **New risk introduced by that change (flag before commit):** nothing in
  `gateway/entrypoint.sh` or `bin/kidnet` populates `kids_known` yet, and the
  running container has no such set. If this ruleset is deployed while the set
  is empty, `ip saddr != @kids_known` matches every island device and drops all
  internet for everyone (portal only), which is a full-island outage. The
  reconciler needs to sync `kids_known` from the active device reservations (the
  same way it syncs `kids_block`) in the same commit, and `container-test.sh`
  should assert a known device still reaches the internet.

- **C1 (credential in git history):** NOT addressed by these edits, and cannot
  be: it requires rotating the live AdGuard password and rewriting history
  before any public push. Still the headline finding. The live box still
  answers to `admin:<dev-password>`.
