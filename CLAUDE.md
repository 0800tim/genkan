# Hearth (working title): agent context

Self-hosted, network-level parental controls plus learn-to-earn. Kids get a
filtered, time-budgeted network island; they earn screen time by learning.
MIT, no telemetry, all data stays in the house. Sibling project: unrot.

## Read these before doing anything

- DECISIONS.md: every design decision and why. Start here, do not re-derive.
- README.md: layout, layers, deploy map.
- PLAN.md: topology and the honest limits of network monitoring.
- RECOMMENDATIONS.md, METERING.md, BUG-BOUNTY.md: policy, metering design,
  the household bug bounty.
- research/: agent research (Omarchy, naming, AdGuard, curriculum).
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

## Iron rules

- NEVER weaken: segment isolation, DNS forcing, the fail-closed segment
  guard, or the safety net (scope='safety' always_allow domains reachable
  even when a kid is cut off).
- Real household values (MAC, tailnet IP, SSID, secrets) live ONLY in
  gitignored config.env / secrets.env. Tracked files stay generic.
- Do not push this repo anywhere public without Tim's explicit go-ahead.
- Never commit anything commercial; that lives outside this repo.
- After ANY change to kids.nft, gateway/ or kidnet: run
  sudo test/firewall-test.sh and sudo test/container-test.sh. Both must
  pass 100% before commit.
- Style: NZ English, plain language, no em or en dashes as punctuation.
- Commit locally per unit of work with the standard trailers; do not push.

## Live state on this box

Dashboard: systemd --user kids-dashboard.service (tailnet :8899). Portal:
kids-portal.service (:8890) pre-deploy; in production it runs in the
container on island :80. DB: kids_network on the shared postgres container
(creds in secrets.env). Deploy: sudo ./deploy.sh once the island is cabled.
