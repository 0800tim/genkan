# Omarchy validation (2026-08-29)

Hearth built and validated on a real Omarchy box over the tailnet, the first
time the stack ran on the target platform rather than the reference box.

This is a point-in-time record of one validation run, not a living document.
Version numbers below were true on the day.

## The box

    "Omarchy"
    7.1.8-arch1-3
    Docker version 29.7.2, build a7dcaa6fdb
    cores 8 ram 7.7Gi
    Two NICs: wlp1s0 (WiFi) + a USB ethernet. Docker present but disabled on
    boot by default (the setup script enables it, needed for a gateway that
    must survive a power cut).

## What passed

- Gateway Docker image builds cleanly (debian:trixie-slim base), 231MB.
- config/nftables/kids.nft PARSES and loads inside the built image using the
  container's own NET_ADMIN cap (so it validates without host sudo).
- docker compose config valid.
- All 8 quiz banks pass tools/validate-quizzes.mjs on the box's node (v26).
- Both Node services and all shell scripts pass syntax checks (fourteen in
  `bin/`, plus deploy.sh, the installer, the warden and the five test rigs).
- install/omarchy-setup.sh assumptions all hold on real Omarchy: docker,
  docker-compose, git in the pacman repos; NetworkManager running (so the
  unmanage-the-NIC drop-in works); ~/.config/omarchy/hooks exists (so the
  post-update hook target is real).

## What still needs Tim's sudo (cannot run headless)

The live steps in deploy.sh and the netns-based host tests (firewall-test.sh,
container-test.sh) need root. On this box sudo requires a password, so an
agent cannot run them unattended. To let the agent do the full deploy, either
run deploy.sh interactively, or grant a narrow passwordless sudo for the
specific commands (documented in the go-live notes).

## Transfer method

The repo reached the box as a clean `git archive` of HEAD (tracked files
only), so no household secrets (config.env, secrets.env) were copied. That is
exactly what a `git clone` gives a new family, so this doubles as a check
that the repo is self-contained.
