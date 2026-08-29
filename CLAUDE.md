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
- docs/DATABASE.md: schema files and the order they must load in.
- docs/tor-and-safety.md: the Tor layer, and what it cannot do.
- docs/HOUSEHOLD-SECURITY.md: the IoT and household layer. What a camera,
  lock or vacuum may talk to, why cloud backup still works, and the limits.
- research/: agent research (Omarchy, naming, AdGuard, curriculum, the
  2026-08-29 security review).
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
the HOST, outside the island. bin/kidnet is the CLI the agent drives.

bin/ holds sixteen scripts: kidnet (the control surface), kidnet-report
(the weekly digest), kidnet-quiz (the learn-to-earn bank manager) and thirteen
background workers driven by systemd timers.
deploy.sh installs fourteen of them and enables six timers; the seventh,
kids-iot-policy.timer, is installed but left disabled because the household
IoT policy is switched on deliberately (docs/HOUSEHOLD-SECURITY.md).
kidnet-report is run from the repo. docs/CLI.md is the reference.

## Iron rules

- NEVER weaken: segment isolation, DNS forcing, the fail-closed segment
  guard, or the safety net (scope='safety' always_allow domains reachable
  even when a kid is cut off).
- Real household values (MAC, tailnet IP, SSID, secrets) live ONLY in
  gitignored config.env / secrets.env. Tracked files stay generic. This repo
  is PUBLIC (github.com/0800tim/hearth), so assume anything you write here is
  read by strangers.
- Never commit anything commercial; that lives outside this repo.
- After ANY change to kids.nft, gateway/ or kidnet: run
  sudo test/firewall-test.sh (31 checks) and sudo test/container-test.sh
  (26 checks). Both must pass 100% before commit.
- Never oversell. If a feature is half built, say which half. The project's
  credibility rests on the limits being stated as plainly as the wins.
- Style: NZ English, plain language, no em or en dashes as punctuation.
- Commit locally per unit of work with the standard trailers; do not push.

## Live state on this box

Deployed and running. Containers hearth-gw, hearth-adguard, hearth-portal
are up; kids-nic-warden plus the meter, metering, services, devicescan and
dnslog timers are enabled. Dashboard: systemd --user kids-dashboard.service
(tailnet :8899, unit lives on the box, not in the repo). Portal:
kids-portal.service (:8890) is the pre-deploy host copy; production is the
container on island :80. DB: kids_network on the shared postgres container
(creds in secrets.env). Operational detail: docs/OPERATIONS.md.
