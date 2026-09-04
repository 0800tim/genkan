# Genkan: agent context

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
- docs/LEARNING.md: the e-learning plan. The Learning home, school notes as
  packages, AI tutors that run on the box and send only the question at hand
  to a model the parent chose, the proposed charter wording, and the table of
  what is built. Almost none of it is built; do not describe it as if it were.
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

bin/ holds nineteen scripts: genkan (the control surface), kidnet (the shim),
genkan-report (the weekly digest), genkan-quiz (the learn-to-earn bank manager),
genkan-quiz-suggest (the evidence briefing for writing new banks, which calls
no AI service) and fourteen background workers driven by systemd timers.
deploy.sh installs sixteen of them and enables seven timers; two more,
kids-iot-policy.timer and kids-summary.timer, are installed but left disabled
because the household IoT policy is switched on deliberately
(docs/HOUSEHOLD-SECURITY.md) and the nightly AI note is the one worker that can
make an outbound request, so it runs only when a parent has turned the card
on, set a key and enabled the timer by hand (PRIVACY-CHARTER.md P1,
docs/OPERATIONS.md). genkan-kid-summary is a bash wrapper around
dashboard/kid-summary.mjs so the brief it sends is built by the same code the
child page shows under "What would leave the house".
genkan-report, genkan-quiz and genkan-quiz-suggest are run from the repo.
docs/CLI.md is the reference.

tools/ is not part of the running system and deploy.sh installs none of it:
validate-quizzes.mjs (the bank checker), worktree-snapshot.sh (commits the
whole tree to refs/genkan/snapshots so a bad git command cannot destroy
uncommitted work; the timer lives on the box, not the repo), publish.sh (the
pre-publish leak scan), validate-package.mjs (community packages),
lint-sql-comments.py (refuses a bash '#' comment written inside a SQL string,
which is legal bash and once killed the whole flagged-domain alert path for a
day), lint-pipefail-grep.py (refuses `printf | grep -q` in a script that sets
pipefail: grep's early exit kills the producer with SIGPIPE and pipefail turns
a successful match into a failure), lint-brand.py (reads the pages we serve
the way a person does, tags stripped, because the speed test said HEARTH for
four days after the rename: its heading was HEA<span>R</span>TH so no search
for the string ever found it), check-pages.sh (fetches every dashboard
page and node --checks each inline script, because one unescaped \n in a
template literal once left the devices page with no working buttons) and
enable-https.sh.

The learn-to-earn content is the largest part of the repo by volume: over 40
quiz banks and more than 2,000 questions in portal/quizzes/ (every question
carries a difficulty and an explanation, every bank carries a subject and an
NZ year band, and every bank has a study page at /study/<bank> in the portal;
count them, do not trust this number). The portal's Learning home, /learn
(dashboard/portal-learn.mjs), lays the shelf out by school year and subject
with what the child has done and one "next up"; the result page explains
every missed question and offers a practice round that earns nothing. Under
GENKAN_DEMO only, the portal shows a child switcher; at home it never lets a
child pick another child. Also here:
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
- After ANY change to bin/genkan-upgrade, bin/genkan-rollback,
  bin/genkan-health or bin/genkan-release-lib.sh: run sudo
  test/release-test.sh (42 checks, throwaway clone and throwaway database).
  NEVER test an upgrade or a rollback against the live gateway.
- After ANY change to kids.nft, gateway/ or genkan: run
  sudo test/firewall-test.sh (46 checks) and sudo test/container-test.sh
  (26 checks). Both must pass 100% before commit. After ANY change to
  config/db/ or bin/genkan-prune: test/schema-test.sh (103 checks, which
  run the pruner end to end on the throwaway) and test/db-role-test.sh
  (105 checks), neither needing root. After ANY change to something that
  raises an alert or to bin/genkan-dnslog: test/alerts-test.sh (20 checks,
  five of which push one AdGuard-shaped entry through the real ingest). Run suites ONE AT A
  TIME: several build a throwaway database or a namespace with a fixed
  name, so two at once collide and report failures that are not real.
- Never oversell. If a feature is half built, say which half. The project's
  credibility rests on the limits being stated as plainly as the wins.
- Style: NZ English, plain language, no em or en dashes as punctuation.
- Commit locally per unit of work with the standard trailers; do not push.

## Live state on this box

Deployed and running. Containers genkan-gw, genkan-adguard, genkan-portal
and genkan-speedtest are up; kids-nic-warden.service plus FIVE timers (meter,
metering, services, devicescan, dnslog). deploy.sh enables six: this box has
no kids-tor-sync.timer installed, so the daily relay refresh is not running
here even though the repo ships it. kids-iot-policy.timer is installed by
deploy.sh and left disabled on purpose. Dashboard: systemd --user
kids-dashboard.service (private network :8899, unit lives on the box; the repo
ships an EXAMPLE at config/systemd-user/genkan-dashboard.service that nothing
installs), with genkan-dashboard-tls.service fronting it on :8443. Its pages
are Home, Right now, Week, Trends, Analytics and logs (dashboard/
analytics-page.mjs: lookups over time, blocked by reason, top sites, the
meter's minutes, and the filterable dns_log itself), Learn to earn, Devices,
Family, Settings, Notifications, System and Speed; /speed proxies the
gateway's speed test, which can only run inside the island. dns_log.reason
and dns_log.filter_list (why AdGuard blocked a name, and which list) exist in
the schema since 2026-09-02; until config/db/schema.sql is re-run on the box
and the current genkan-dnslog is installed, the live rows have neither.
Settings
(dashboard/settings.mjs) edits the filter levels, the allow list a parent can
grow but not narrow, and the household switches, and writes ONLY through
`genkan tier set`, `genkan allow add|remove`, `genkan claim-mode`, `genkan iot
mode`, `genkan slow-rate|slow-timeout`, `genkan retention set` and `genkan
prune preview|now|dns-log` (runKidnet); the levels' AdGuard
half lives in policies since config/db/schema-settings.sql, and the database
wins over hand tuning in the AdGuard UI. Its Storage card (database size,
disk free, growth, one editable retention rule per table from `retention`,
a dry-run preview and the prune buttons) reads the `storage_status` view;
deleting is bin/genkan-prune's alone, as the database owner, audited in
block_events in the same statement as the delete. Until
config/db/schema-retention.sql and grants.sql are re-run on this box, the
live database has no `storage_status` view and kids_agent cannot read
`retention`, so the card shows sizes and says the rules are missing. plus one page per child at /kid/<name> (dashboard/kid-insights.mjs: today,
the fortnight, what changed, suggested rewards and the opt-in AI note written
nightly by bin/genkan-kid-summary when a parent turns it on, reached from
every child's name on Home, Family, Week and Trends). Portal: kids-portal.service (:8890) is the pre-deploy host copy;
production is the container on island :80. DB: kids_network on the shared
postgres container (creds in secrets.env).

genkan-snapshot.timer (systemd --user, every two minutes) runs
tools/worktree-snapshot.sh save. Development safeguard, not a household one:
the unit is on the box, not in the repo.

Two PUBLIC demos run the same code read-only against a seeded fictional
household, so they improve whenever the product does: demo.genkan.nz
(the dashboard) and quiz-demo.genkan.nz (the kid's portal, with one
child deliberately out of time). Both are demo/, both set GENKAN_DEMO=1, which
turns every shell-out into a no-op. Operational detail: docs/OPERATIONS.md.
