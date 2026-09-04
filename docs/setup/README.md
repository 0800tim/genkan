# Setting up a Genkan gateway

Genkan turns one small Linux box into your family's network gateway:
filtered, time-budgeted internet for the kids, a learn-to-earn portal, and
a CLI (`genkan`) your AI agent drives from chat. These guides get you from
bare hardware to a running island.

## Pick your platform

| Guide | For |
|---|---|
| [raspberry-pi.md](raspberry-pi.md) | A Raspberry Pi 3, 4 or 5. The "any old hardware" path. |
| [debian-ubuntu.md](debian-ubuntu.md) | A Debian or Ubuntu server, mini PC, or retired laptop. |
| [generic-linux.md](generic-linux.md) | Any other distro. The contract, and how to adapt. |
| [../SETUP-OMARCHY.md](../SETUP-OMARCHY.md) | Omarchy (Arch), the reference platform. |

## The kids' wifi

| Guide | For |
|---|---|
| [ap-hg659.md](ap-hg659.md) | A spare Huawei HG659, the router several NZ ISPs handed out. Also the seven steps that work on any old router. |

## The universal shape

Every Genkan gateway is the same machine wearing different clothes: one
Linux box with two network paths.

1. An uplink to your existing home router. Usually the built-in ethernet.
2. A leg for the kids' network. Either a second wired interface (a USB
   gigabit ethernet dongle, a second NIC, a spare PCIe card) feeding a
   switch or access point, or a WiFi radio on the box itself running as an
   access point.

Everything else is identical on every platform, because everything
island-facing runs in Docker. The gateway container owns its own network
namespace holding exactly two interfaces: a docker uplink and `kids0`, the
physical kids-side interface, handed in by a tiny host-side warden service.
The firewall (nftables), DHCP, DNS and filtering (AdGuard Home) and the kid
portal all live inside that namespace. Postgres holds the desired state and
the gateway reconciles the firewall from it every 15 seconds. A bad rule
can degrade the island, never the house. If the box dies, the kids'
internet goes down and the house network does not notice.

## The universal flow

1. Install Linux on the box. Any distro with Docker works.
2. Clone this repo onto it.
3. Open your AI agent in the repo and say: "Read CLAUDE.md and
   docs/setup/<your platform>.md, then set this box up as our Genkan
   gateway." The agent does the fiddly parts: package installs, marking
   the kids' NIC as unmanaged, provisioning Postgres and loading the schema,
   running `deploy.sh`, and proving it works with the test rigs. Provisioning
   Postgres is the one step no script in this repo does for you.
4. Plug in the access point for the kids' WiFi (an old router flipped to
   AP or bridge mode is ideal) and move the kids' devices onto it.

You can do every step by hand instead. Each guide gives the full manual
path. But the guides are written assuming an agent executes most of it and
you supervise.

## Steps every platform shares

These live here once so the platform guides do not repeat them.

### The database

Genkan keeps state (children, devices, blocks, the time ledger, quiz
results, alerts) in Postgres. The stack expects a container named
`postgres` on a Docker network named `postgres`. If you do not already run
one:

    docker network create postgres
    docker run -d --name postgres --restart unless-stopped \
      --network postgres \
      -e POSTGRES_PASSWORD=change-me \
      -p 127.0.0.1:5432:5432 \
      -v genkan-pgdata:/var/lib/postgresql/data \
      postgres:16

Then create the database and app role, set both URLs in `secrets.env`, and
load the schema in order. The exact files and order are in
[../DATABASE.md](../DATABASE.md). Your agent can do all of this.

### Deploy and prove

From the repo root, once `config.env` and `secrets.env` exist:

    sudo ./deploy.sh                # validates, builds, installs, starts
    docker logs -f genkan-gw        # watch for the segment guard verdict
    genkan allow-status             # safety net populated?
    sudo test/container-test.sh     # full packet-level proof, 26 checks

The segment guard matters: on every appearance of `kids0` the gateway
listens on the wire first. If it hears another DHCP server or traffic from
a foreign subnet, the island refuses to start and raises an alert. That is
deliberate. It catches an access point still bridged to your main LAN
before Genkan's DHCP can fight your router's.

## Once it is running

- [../CLI.md](../CLI.md): every command, its arguments, and what it really
  does. Written from the scripts.
- [../OPERATIONS.md](../OPERATIONS.md): the day-two guide. Health checks, what
  each timer does, reading the gateway logs, what the segment guard refusing to
  start means, a device with no internet, rotating the AdGuard password,
  backing up and restoring the database.
- [../AGENT.md](../AGENT.md): what to say to your agent, and what it runs.
- [../../BUG-BOUNTY.md](../../BUG-BOUNTY.md): hand this one to your teenager.

## The ethos

**Omarchy-first, genuinely distro-agnostic.** We build and test on Omarchy
because its agent-first design fits how Genkan is operated. But nothing in
Genkan depends on it: the stack is Docker plus standard Linux tooling
(systemd, nftables inside the container, a NetworkManager drop-in or its
equivalent on the host). If your distro runs Docker, it runs Genkan.

**AI agents make a fiddly setup easy.** A network gateway build is
genuinely fiddly: interface names, MACs, firewall semantics, DHCP scope.
Genkan leans into the agent doing that work. The repo carries CLAUDE.md and
runbooks written for machines as much as people, and the control surface is
a plain CLI, so any agent that can run shell commands can both build and
operate it. Bring your own agent: Claude Code, Codex, Gemini CLI, a local
model.

**You own the hardware and the data.** Everything runs in your house on
your box. DNS logs, quiz results, the time ledger: all of it stays in your
Postgres. Nothing phones home, there is no account, no telemetry, and no
cloud service whose shutdown could brick your family's internet. MIT
licensed. If this project vanished tomorrow, your gateway keeps working.
