# Hearth on any Linux

The distro-agnostic recipe. Hearth is Omarchy-first in spirit but there is
nothing Arch-shaped in it: the whole island runs in Docker, and the host
side is one shell script, one systemd unit, and a handful of CLIs. If your
distro can run Docker and systemd, it can be a Hearth gateway.

Read [README.md](README.md) in this directory first for the universal
shape and the shared steps (database, deploy, segment guard). If your
distro is Debian-family or a Raspberry Pi, use those guides instead; the
Omarchy guide at [../SETUP-OMARCHY.md](../SETUP-OMARCHY.md) covers Arch.

## The contract

A Hearth gateway needs exactly this from the host:

1. **Linux with systemd.** The NIC warden, meter and log-shipping timers
   are systemd units, installed by `deploy.sh` into `/etc/systemd/system`.
2. **Docker Engine with the compose plugin.** The gateway, AdGuard and the
   portal are containers; the gateway owns a private network namespace.
   Rootless Docker will not work (the warden moves a physical NIC into the
   container's namespace, which needs real root), and container runtimes
   without Docker's CLI surface (`docker inspect`, `docker exec`, compose
   profiles) are untested.
3. **A second network interface** for the kids' side, plus the primary
   uplink. USB dongle, second NIC, or the WiFi-bridge construction from
   the Raspberry Pi guide's topology A, which works on any laptop with a
   hostapd-capable radio.
4. **Postgres reachable as a container named `postgres`** on a Docker
   network named `postgres` (see the shared steps in README.md).
5. **Standard tooling on the host:** bash, git, curl, openssl, `nft` (the
   nftables userland, used only to validate the ruleset before build; the
   live firewall runs inside the container), `ip`/`nsenter` (iproute2 and
   util-linux, present everywhere), and `psql` only if you want to poke
   the database directly.
6. **The host's network manager keeping its hands off the kids' NIC.**
   NetworkManager drop-in, systemd-networkd `Unmanaged=yes`, or your
   distro's equivalent.

Everything else (`kidnet`, the warden, the timers) is installed by
`sudo ./deploy.sh` and is plain bash plus systemd.

## Adapting the steps to your distro

Only two things in the guides are distro-specific.

**Package installs.** You need: docker + compose plugin, git, nftables,
openssl, curl, and (WiFi-AP topology only) hostapd and iw. Names by
family:

| Family | Command |
|---|---|
| Debian/Ubuntu | `apt install docker.io docker-compose-v2 git nftables openssl curl` |
| Arch/Omarchy | `pacman -S docker docker-compose git nftables openssl curl` |
| Fedora/RHEL | `dnf install docker-ce docker-ce-cli docker-compose-plugin git nftables openssl curl` (Docker's repo) |
| openSUSE | `zypper install docker docker-compose git nftables openssl curl` |
| Alpine | Not recommended: OpenRC, not systemd. See the contract. |

Then `systemctl enable --now docker` and add your user to the `docker`
group. On Fedora, prefer Docker CE over the default Podman: Hearth's
warden and `kidnet` shell out to the Docker CLI, and Podman's netns
layout differs. Podman may be workable but is untested; report back if
you try. SELinux-enforcing distros are also untested territory: the
gateway needs `NET_ADMIN`/`NET_RAW` and the warden uses `nsenter`, both
of which a strict policy can block. `audit2allow` is your friend, and we
would welcome a documented policy from anyone who does this properly.

**Persistence.** Make the pieces survive reboots and upgrades the way
your distro expects:

- `net.ipv4.ip_forward=1` in `/etc/sysctl.d/99-hearth.conf` (Docker
  usually sets it; pin it anyway).
- `deploy.sh` already enables the warden and timers; confirm with
  `systemctl is-enabled docker kids-nic-warden`.
- All containers are `restart: unless-stopped`, so `docker` coming up at
  boot brings the island up.
- If your distro has post-upgrade hooks (like Omarchy's `post-update`),
  add one that runs `docker compose --profile island up -d` in the repo.
  Otherwise the rule is simply: after a big upgrade, re-run
  `sudo ./deploy.sh`. It is idempotent.

## The agentic path

The same as every platform. Clone the repo on the gateway box, start your
agent in it, and say:

> Read CLAUDE.md and docs/setup/generic-linux.md. This box runs <your
> distro>. Set it up as our Hearth gateway: satisfy the contract section
> with this distro's packages, keep the network manager off the kids'
> NIC, provision the database per docs/DATABASE.md, run deploy.sh, then
> verify. Stop and ask me if anything fails.

Verification and troubleshooting are identical on every distro; use the
sections in [debian-ubuntu.md](debian-ubuntu.md).

## A short honest note about macOS

macOS is not a supported gateway target, and cannot be. Docker on macOS
runs containers inside a hidden Linux VM, so a container cannot take
ownership of a physical NIC on the Mac, and the warden's namespace
handover (`ip link set <nic> netns <pid>`) is Linux-kernel networking
with no macOS equivalent. The same applies to Windows.

What does run anywhere is the agent side: the runbooks, the curriculum
generation tools, and talking to a gateway's `kidnet` over SSH or a
tailnet all work fine from a Mac. Your laptop can be the cockpit; the
gateway itself must be a Linux box, and the whole point of these guides
is that almost any old one will do.
