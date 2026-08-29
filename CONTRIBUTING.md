# Contributing

This is a self-hosted, network-level parental-control island: clawdia (or
any always-on Linux box) becomes the gateway for a separate kids/guest
network, so internet on/off, category blocks, schedules and DNS filtering
are things you own. MIT, no telemetry, your data stays on your box.

Sibling project: [unrot](https://github.com/0800tim/unrot) (device-side
"earn screen time by studying"). This one is the network side.

PRs welcome. Keep it dependency-light and runnable on a stock Debian/Ubuntu
box + Postgres. Never commit real MACs/secrets; use config.env (gitignored).
