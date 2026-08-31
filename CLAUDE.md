# Hearth: agent context

Self-hosted, network-level parental controls plus learn-to-earn. Kids get a
filtered, time-budgeted network island; they earn screen time by learning.
MIT, no telemetry, all data stays in the house. Sibling project: unrot.

## Read these before doing anything

- DECISIONS.md: every design decision and why. Start here, do not re-derive.
- README.md: the front door. What it is, what it honestly cannot do, layers.
- docs/CLI.md: every command, its arguments and what it actually does.
  Generated from the scripts. Read it before inventing a flag.
- docs/OPERATIONS.md: health checks, the timers, reading logs, troubleshooting,
  the AdGuard password, database backup and restore.
- PLAN.md: topology and the honest limits of network monitoring.
- RECOMMENDATIONS.md, METERING.md, BUG-BOUNTY.md: policy, metering design,
  the household bug bounty.
- category_state.set_by decides who may lift a block. The precedence table is
  in DECISIONS.md ("Bedtimes ran themselves"). Read it before touching any
  code that unblocks a child: a schedule lifts only set_by='bedtime', and
  earning time lifts only set_by='out-of-time'.
- docs/DATABASE.md: schema files and the order they must load in.
- docs/UPGRADING.md, docs/RELEASING.md: the version scheme, how a release is
  cut, how a household updates, and exactly what a rollback cannot undo.
  config/db/load.sh is the executable copy of that order and wins any argument.
- LEARN-TO-EARN.md: the quizzes, the reading list, the economics, and the
  table of what is built and what is not. portal/quizzes/FORMAT.md is the
  bank format; CONTRIBUTING.md is what makes a good explanation.
- docs/READING-LIST.md: what a blocked child can still read, the five tests a
  site must pass, and the well-known school sites that were rejected.
- docs/GAMIFICATION.md: badges, and why the house board is not a leaderboard.
  Off by default.
- docs/DEVICE-IDENTITY.md: device claiming, and why a child's claim grants
  nothing until a parent confirms it. Off by default.
- docs/tor-and-safety.md: the Tor layer, and what it cannot do.
- docs/NOTIFICATIONS.md: how alerts reach a parent's phone, the routes that
  are built and the two that are not, and the exact words that land on a lock
  screen. Read it before changing any alert wording.
- docs/HOUSEHOLD-SECURITY.md: the IoT and household layer. What a camera,
  lock or vacuum may talk to, why cloud backup still works, and the limits.
- research/: agent research (Omarchy, naming, AdGuard, curriculum, the
  2026-08-29 security review, and the 2026-08-30 review and pen test).
- docs/runbooks/: runbooks other parents hand to their own AI agents.

## Architecture in one breath

A Docker container (gateway/, compose.yaml) owns its own network namespace
with exactly two interfaces: eth0 (docker bridge uplink) and kids0 (the
physical USB NIC, handed in by host/kids-nic-warden.sh, the only host-side
piece). Firewall (config/nftables/kids.nft), DHCP+DNS (AdGuard, config/
adguard/) and the kid portal (dashboard/portal.mjs) all live in that
namespace and physically cannot touch the host, main LAN or tailnet.
Postgres holds desired state; the gateway reconciles the firewall from it
every 15s. The admin dashboard (dashboard/server.mjs) binds the tailnet on
the HOST, outside the island. bin/genkan is the CLI the agent drives; it was
called kidnet until 2026-08-31 and bin/kidnet remains as a compat shim.

bin/ holds eighteen scripts: genkan (the control surface), kidnet (the shim),
kidnet-report (the weekly digest), kidnet-quiz (the learn-to-earn bank manager),
kidnet-quiz-suggest (the evidence briefing for writing new banks, which calls
no AI service) and thirteen background workers driven by systemd timers.
deploy.sh installs fifteen of them and enables six timers; the seventh,
kids-iot-policy.timer, is installed but left disabled because the household
IoT policy is switched on deliberately (docs/HOUSEHOLD-SECURITY.md).
kidnet-report, kidnet-quiz and kidnet-quiz-suggest are run from the repo.
docs/CLI.md is the reference.

tools/ is not part of the running system and deploy.sh installs none of it:
validate-quizzes.mjs (the bank checker), worktree-snapshot.sh (commits the
whole tree to refs/hearth/snapshots so a bad git command cannot destroy
uncommitted work; the timer lives on the box, not the repo), publish.sh (the
pre-publish leak scan), validate-package.mjs (community packages),
lint-sql-comments.py (refuses a bash '#' comment written inside a SQL string,
which is legal bash and once killed the whole flagged-domain alert path for a
day), lint-pipefail-grep.py (refuses `printf | grep -q` in a script that sets
pipefail: grep's early exit kills the producer with SIGPIPE and pipefail turns
a successful match into a failure) and enable-https.sh.

The learn-to-earn content is the largest part of the repo by volume: over 40
quiz banks and more than 2,000 questions in portal/quizzes/ (every question
carries a difficulty and an explanation, and every bank has a study page at
/study/<bank> in the portal; count them, do not trust this number),
the reading list in config/db/schema-learn*.sql (scope='learn' rows in
always_allow, reachable through a total cut), and badges in dashboard/badges.mjs
plus config/db/schema-badges.sql. Badges' house board and device claiming
(config/db/schema-claim.sql, genkan claim-mode / claims / confirm / unclaimed,
the kids_unclaimed nft set) are both OFF BY DEFAULT and must stay that way.

## Iron rules

- NEVER weaken: segment isolation, DNS forcing, the fail-closed segment
  guard, or the safety net (scope='safety' always_allow domains reachable
  even when a kid is cut off).
- Real household values (MAC, tailnet IP, SSID, secrets) live ONLY in
  gitignored config.env / secrets.env. Tracked files stay generic. This repo
  is PUBLIC (github.com/0800tim/genkan), so assume anything you write here is
  read by strangers.
- Never commit anything commercial; that lives outside this repo.
- After ANY change to bin/kidnet-upgrade, bin/kidnet-rollback,
  bin/kidnet-health or bin/kidnet-release-lib.sh: run sudo
  test/release-test.sh (42 checks, throwaway clone and throwaway database).
  NEVER test an upgrade or a rollback against the live gateway.
- After ANY change to kids.nft, gateway/ or genkan: run
  sudo test/firewall-test.sh (46 checks) and sudo test/container-test.sh
  (26 checks). Both must pass 100% before commit. After ANY change to
  config/db/: test/schema-test.sh (88 checks) and test/db-role-test.sh
  (77 checks), neither needing root. After ANY change to something that
  raises an alert: test/alerts-test.sh (15 checks). Run suites ONE AT A
  TIME: several build a throwaway database or a namespace with a fixed
  name, so two at once collide and report failures that are not real.
- Never oversell. If a feature is half built, say which half. The project's
  credibility rests on the limits being stated as plainly as the wins.
- Style: NZ English, plain language, no em or en dashes as punctuation.
- Commit locally per unit of work with the standard trailers; do not push.

## Live state on this box

Deployed and running. Containers hearth-gw, hearth-adguard, hearth-portal
and hearth-speedtest are up; kids-nic-warden.service plus FIVE timers (meter,
metering, services, devicescan, dnslog). deploy.sh enables six: this box has
no kids-tor-sync.timer installed, so the daily relay refresh is not running
here even though the repo ships it. kids-iot-policy.timer is installed by
deploy.sh and left disabled on purpose. Dashboard: systemd --user
kids-dashboard.service (private network :8899, unit lives on the box; the repo
ships an EXAMPLE at config/systemd-user/hearth-dashboard.service that nothing
installs), with hearth-dashboard-tls.service fronting it on :8443. Its pages
are Home, Right now, Week, Trends, Learn to earn, Devices, Family, System and
Speed; /speed proxies the gateway's speed test, which can only run inside the
island. Portal: kids-portal.service (:8890) is the pre-deploy host copy;
production is the container on island :80. DB: kids_network on the shared
postgres container (creds in secrets.env).

hearth-snapshot.timer (systemd --user, every two minutes) runs
tools/worktree-snapshot.sh save. Development safeguard, not a household one:
the unit is on the box, not in the repo.

Two PUBLIC demos run the same code read-only against a seeded fictional
household, so they improve whenever the product does: genkan-demo.appspurt.dev
(the dashboard) and genkan-portal.appspurt.dev (the kid's portal, with one
child deliberately out of time). Both are demo/, both set HEARTH_DEMO=1, which
turns every shell-out into a no-op. Operational detail: docs/OPERATIONS.md.
