# Hardware: what actually works

The gateway is not fussy. It is an ordinary 64-bit Linux box with two network
paths, and the software is Docker plus standard tooling. Almost anything in a
cupboard will do.

What this file adds to the platform guides in [setup/](setup/) is honesty about
**which combinations have genuinely been run and which are reasoned inference.**
Those are not the same thing and it matters when you are choosing what to buy.

Three labels are used throughout, and they mean exactly what they say.

| Label | Meaning |
|---|---|
| **Run** | Genkan has been deployed and used on this, in a house, over time. |
| **Validated** | The build, the ruleset and the scripts were exercised on this hardware, but a live deploy was not completed on it. |
| **Inference** | Nobody has tried it. It is expected to work because of what it is, and the reasoning is given. Treat it as a hypothesis. |

---

## The one thing everybody gets wrong

**The second network interface.** More setups fail here than everywhere else
combined, and every failure is one of four shapes.

1. **There is only one interface.** A mini PC or a laptop with a single
   ethernet port and wifi. Genkan needs a path to the house router and a
   separate path to the kids, and one port cannot be both. You need a second
   interface before anything else in this document matters.
2. **The wrong interface is chosen as the kids' side.** If you nominate your
   uplink, the NIC warden hands your route to the internet into a container and
   the house goes dark. Nothing in the software can tell your intent from the
   MAC, so this is on you and your agent to get right. Unplug the adapter, run
   `ip -o link show`, plug it in, run it again: the one that appeared is the
   kids' side.
3. **The host's network manager keeps taking the interface back.** The warden
   cannot hand over an interface NetworkManager is holding. It needs an
   explicit drop-in (`unmanaged-devices=mac:...`, lower case) or a
   systemd-networkd `Unmanaged=yes` file, and a reload. `nmcli device` must say
   `unmanaged`, and until it does, nothing works.
4. **The MAC in `config.env` has a typo.** The warden lower-cases what it
   reads, so case is not the problem; a wrong octet is. `journalctl -u
   kids-nic-warden` prints exactly what it is looking for.

If you read nothing else here, read that list before you buy anything.

---

## Machines: what has been run

### The reference box: **Run**

An x86_64 Ubuntu 26.04 workstation with plenty of RAM, using its onboard
ethernet (`enp5s0`) as the uplink and an **ASIX AX88179** USB 3.0 gigabit
adapter (USB ID `0b95:1790`, driver `ax88179_178a`) as the kids' side.

This is the combination Genkan was developed on and runs on daily. The
containers `hearth-gw`, `hearth-adguard`, `hearth-portal` and
`hearth-speedtest` all run here, the timers run here, and the firewall and
container test suites pass on this box.

It is more machine than the job needs. The gateway idles at a small fraction of
it. Do not read the reference box's specification as a requirement.

### Omarchy (Arch): **Validated**

Genkan was built and checked end to end on a real Omarchy box on 2026-08-29:
eight cores, 7.7GiB RAM, two interfaces (a wifi radio and a USB ethernet),
Docker 29.7.2. The record is [OMARCHY-VALIDATION.md](OMARCHY-VALIDATION.md).

What passed there: the gateway image builds cleanly, `config/nftables/kids.nft`
parses and loads inside the built image using the container's own `NET_ADMIN`,
`docker compose config` is valid, every script passes syntax checks, and
`install/omarchy-setup.sh`'s assumptions about pacman, NetworkManager and the
Omarchy hooks directory all hold.

What did **not** happen: a live deploy. `deploy.sh` and the netns test rigs need
root, sudo on that box wanted a password, and an agent could not run them
unattended. So Omarchy is validated, not run. The honest read is that the
software side is proven on Arch and the live network handover is not.

### Debian and Ubuntu on a mini PC or an old laptop: **Inference, on solid ground**

The reference box is Ubuntu, so the distro family is genuinely exercised. What
is inference is the specific class of machine: a 1-litre tiny PC (ThinkCentre,
OptiPlex Micro, EliteDesk Mini) or a retired laptop. There is nothing in Genkan
that would notice the difference between those and the reference box: same
architecture, same kernel, same Docker, same handover.

The laptop case has one genuine advantage worth naming: **its battery is a free
UPS**, and it is the only configuration that rides through a short power cut
without buying anything.

### Raspberry Pi: **Inference. No Pi has run Genkan.**

[setup/raspberry-pi.md](setup/raspberry-pi.md) is a careful and detailed guide,
and it has not been executed on a Pi by this project. Say that out loud before
you buy one on the strength of it.

The reasoning behind the guide is sound. Every image in the stack
(`debian:trixie-slim`, `adguard/adguardhome`, `node:22-slim`, `postgres`) is
published for arm64. Nothing in `config/nftables/kids.nft`, the warden or
`kidnet` is architecture-specific: it is nftables, iproute2, `nsenter` and
bash. Raspberry Pi OS is Debian, so the Debian guide's host-side steps apply.

What is genuinely unknown, and would be the first thing to check on a Pi:

- The gateway image has never been **built** on arm64 in this project.
- Postgres on an SD card under a metering workload that writes every minute.
  The guide warns about SD wear and recommends a USB SSD on a Pi 4 or 5. That
  warning is inference too, though it is inference everyone who has run a Pi
  server shares.
- The Pi 3 throughput numbers in the guide (roughly 40 to 90 Mbps through the
  island) are derived from the platform's known 100Mbit ethernet on a shared
  USB 2.0 bus, not measured on Genkan.

If you run Genkan on a Pi, that is the single most useful contribution anyone
could make to this file right now.

### What will not work at all

- **macOS and Windows.** Not a supported gateway target and cannot be. Docker
  on both runs containers inside a hidden Linux VM, so a container cannot take
  ownership of a physical NIC, and the warden's `ip link set <nic> netns <pid>`
  handover is Linux-kernel networking with no equivalent. Your Mac makes a fine
  cockpit for talking to a gateway over SSH or a private network. It cannot be
  the gateway.
- **Rootless Docker.** Moving a physical NIC into a container's namespace needs
  real root.
- **The Docker snap on Ubuntu.** Its confinement breaks `nsenter` and the
  namespace handover. Use Docker's own packages or apt's `docker.io`.
- **Alpine and anything without systemd.** The warden and all the timers are
  systemd units.
- **Podman and SELinux-enforcing distros.** Untested rather than known-broken.
  Podman's namespace layout differs and the tooling shells out to the Docker
  CLI; a strict SELinux policy can block `NET_ADMIN`, `NET_RAW` and `nsenter`.
  Both are documented in [setup/generic-linux.md](setup/generic-linux.md) as
  territory nobody has mapped.

---

## Sizing

The gateway is a router with a database attached. It is not demanding, and the
usual mistake is to over-buy.

| Household | CPU | RAM | Storage | Notes |
|---|---|---|---|---|
| 1 to 2 kids, a handful of devices | 2 cores | 2GB | 16GB | The floor. A Pi 4 sits here. |
| 3 to 5 kids, 10 to 20 devices | 2 to 4 cores | 4GB | 32GB SSD | The realistic target. Any 1-litre mini PC clears it easily. |
| Busy house, 20+ devices, gigabit internet | 4 cores | 8GB | 64GB SSD | Headroom for the per-service metering and a longer query log. |
| Also running the dashboard, the demo, other containers | 4+ cores | 8GB+ | 128GB SSD | The reference box's territory. |

What actually consumes anything:

- **Postgres** is the only component that grows. The DNS log and the
  per-category and per-service usage tables are written continuously. Storage,
  not CPU, is what you should size for.
- **The metering timers** run every minute and are short. They will not trouble
  a modern CPU, and the guides note that a page costing a process spawn every
  few seconds is the sort of thing that does trouble a Pi.
- **Throughput** is a routing question, so the ceiling is your slowest
  interface. A gigabit USB adapter on a USB 3.0 port will not be your
  bottleneck. A Pi 3's 100Mbit port on a shared USB 2.0 bus will be.

RAM is mostly Postgres and the two small Node services. Nothing here needs
anything exotic.

---

## The second interface, option by option

### USB gigabit ethernet adapter: the recommended answer

Cheapest, simplest, and what the reference box uses.

| Chipset | Status | Notes |
|---|---|---|
| **ASIX AX88179 / AX88179A** | **Run** | Exactly what the reference box uses (`ax88179_178a`). USB 3.0, gigabit, in-tree driver, no firmware blob. Buy this one. |
| **Realtek RTL8153** | Inference | The other chipset the setup guides name. Very common, in-tree `r8152` driver, widely used on Linux. Expected to work; nobody here has run one. |
| Anything advertised as "USB 2.0 ethernet" | Avoid | 100Mbit on a shared bus. It becomes the household's ceiling. |
| Anything that ships a driver CD or a `.deb` | Avoid | If it needs an out-of-tree driver, it will break on a kernel update, on the box your family's internet depends on. |

Practical notes:

- Use a **USB 3.0 port** (usually blue). A gigabit adapter on a USB 2.0 port is
  a 480Mbit adapter with extra steps.
- The chipset is what matters, not the brand on the box. Plug it in and run
  `lsusb` and `ip -o link show`: a good adapter reports a recognisable chipset
  and gets a driver with no intervention.
- **USB adapters get an automatic recovery path that built-in NICs do not.** The
  warden discovers the adapter's USB device path at start, and if the NIC ever
  goes missing from both the host and the container (which USB ethernet
  genuinely does when a container namespace is destroyed), it resets the
  adapter through `/sys/bus/usb/devices/<path>/authorized` and carries on. A
  second onboard NIC or a PCIe card has no such path, so the same fault needs a
  human. This is a small but real argument for the dongle over the card.

### A second onboard NIC, or a PCIe card

**Inference.** Nothing in Genkan cares how the interface got there: the warden
matches on MAC and hands the interface over the same way. A machine with two
onboard ports is arguably the tidiest build there is.

The two things you give up: the USB auto-reset described above, and the ability
to identify the kids' side by unplugging it. Note both MACs carefully before
you start.

### A wifi radio on the box itself, via hostapd: **not tested, and say so**

[setup/raspberry-pi.md](setup/raspberry-pi.md) documents this in full: hostapd
on the host, a `br-kids` bridge, a veth pair with a fixed
locally-administered MAC handed into the container as `kids0`. The design keeps
the containment model intact, and the reasoning is careful.

It has **never been run on real hardware**, and the project's own roadmap says
so. If you choose it, you are the first, and the following are all live risks
rather than solved problems:

- The onboard radio on a Pi gets flaky somewhere around eight to ten clients.
- Intel laptop chipsets do AP mode on 2.4GHz only. Broadcom mostly not at all.
- `br_netfilter` makes bridged frames traverse the host's iptables, so a `ufw`
  default deny silently eats the kids' DHCP broadcasts. Devices join the wifi
  and never get an address, with nothing obvious in any log. The fix is
  `sudo ufw allow in on br-kids`, and it is only needed in this topology.
- Wifi power saving left on is a classic source of mystery dropouts on an AP.

Use it to prove the idea in an evening. Do not use it as the steady state for a
house that depends on it. A cheap USB adapter and a real access point is a
better answer in every dimension except cost, and the cost difference is about
thirty dollars.

---

## The access point

The kids' wifi does not come from the Genkan box in the recommended build. It
comes from a separate access point cabled to the kids' interface, and it must
be a genuinely dumb one.

**What it has to be, and why each one matters:**

- **Factory reset**, if it used to be a router. Old configuration is where
  every surprise in this list comes from.
- **Access Point or bridge mode.** In router mode it would NAT the whole island
  behind one address, which hides every device behind a single IP and destroys
  per-device control. This is the point of the whole exercise, so get it right.
- **Its own DHCP server off.** The Genkan box, through AdGuard in the container,
  is the island's single DHCP and DNS server. Two DHCP servers on one wire is a
  race, and the child wins it about half the time.
- **Not connected to your main LAN in any way.** One cable, from the kids'
  interface to the AP. Not a second cable to the house switch. Not meshed to
  your house wifi.

**The segment guard checks exactly this**, on every appearance of `kids0`, by
listening on the wire before it serves anything. If it hears another DHCP
server or traffic from a foreign subnet, the island refuses to start and raises
an alert. If that happens to you, the guard is right and your access point is
wrong.

### Field notes: TP-Link Deco X20. **Run.**

The reference household's access point, and the source of the segment guard.

- **It is app-only.** No web UI, no SSH, no API, no rooting path. Factory reset,
  a standalone network, then Access Point mode, all in the phone app. That is
  the entire configuration and there is nothing else to tune.
- **Genkan does not need to control it**, which is why an app-only unit is
  acceptable. Once it is in AP mode it is a dumb bridge and the Genkan box owns
  addresses, DNS, filtering and time.
- **The incident worth knowing.** Freshly plugged in, the Deco bridged the main
  house LAN onto the kids' port, because it was still meshed to the house wifi.
  Starting DHCP there would have fought the house router. That is the real
  event the segment guard exists because of, and it will happen to somebody
  else. Factory reset properly and un-mesh it before you cable it in.

Cabling that has actually been used: kids' interface to Deco port 1, Deco port 2
to a small switch, switch to the wired devices.

Any old router flipped to AP mode works the same way. The Deco is documented
because it is the one that has been run, not because it is recommended over
alternatives.

---

## Power, and what happens in an outage

The gateway becomes the kids' only route to the internet. It should come back
on its own, and you should know exactly what breaks while it is down.

### What happens when the gateway is off

- **The house network is unaffected.** Your router keeps routing, your own
  devices keep working. This is a property of the topology, not a mitigation:
  the island hangs off a separate interface, and the main LAN never depended on
  the Genkan box.
- **The kids have no internet.** No DHCP, no DNS, no route. Devices already
  holding a lease lose the gateway and stop.
- **The safety net is down too**, and this is worth sitting with. The help
  lines survive a block, a bedtime and a cut, because those are firewall
  states. They do not survive the box being off, because there is no firewall.
  A gateway that stays down for days is a real thing to fix, not a minor
  inconvenience.
- **Nothing is lost.** All state is in Postgres. The gateway reconciles the
  firewall from the database every fifteen seconds when it comes back.

### Coming back by itself

- **Set "restore power on AC loss" in the BIOS** on any desktop or mini PC.
  Without it a power cut leaves the box off until somebody presses the button,
  which will be a Tuesday when you are away.
- **Docker must be enabled at boot**, and the containers are all
  `restart: unless-stopped`, so Docker starting brings the island up.
  `systemctl is-enabled docker kids-nic-warden` should say `enabled` twice.
- **A laptop is the cheapest UPS you can buy**, because you already own it.
  Leave it on mains, ignore the lid, and mask the sleep targets. It rides
  through a short cut and shuts down cleanly on a long one.
- **A real UPS** is worth it mainly for the storage, not the uptime. Postgres
  and SD cards both dislike being cut off mid-write.

### Storage and power cuts

- **SD cards die from this.** A Pi gateway writes to Postgres every minute
  forever. On a Pi 4 or 5, boot from a USB SSD. On any Pi, keep a flashed spare
  card in a drawer.
- **Back up the Postgres volume.** It is the only thing that is not
  reproducible from the repo: the people, the devices, the time ledger, the
  quiz history, the alerts. `docs/OPERATIONS.md` has the backup and restore
  procedure.
- **Undervoltage on a Pi causes exactly the flakiness you do not want on a
  gateway.** Use the official supply, and check `dmesg | grep -i voltage` when
  something is inexplicably slow.

---

## The shopping list

For a household that has a spare 64-bit machine already:

| Item | Roughly | Needed when |
|---|---|---|
| USB gigabit ethernet adapter, AX88179 or RTL8153 | NZD 20-45 | The box has one ethernet port. Almost always. |
| An access point | Nothing, if you have an old router | Always, unless you are trying the untested wifi-AP topology. |
| A short ethernet cable | A few dollars | Kids' interface to the access point. |
| A small unmanaged switch | NZD 20-40 | Only if you have wired devices on the kids' side. |
| A USB SSD | NZD 40-80 | A Raspberry Pi you intend to keep running. |
| A USB stick | You have one | Installing the operating system. |

That is the whole bill. There is no subscription and nothing to buy from
anybody involved with this project.

---

## Contributing to this file

The most valuable thing you can send is a **Run** row: hardware you actually
deployed on, what worked, and what the guide got wrong on your box. The Pi is
the biggest gap, then a second-onboard-NIC build, then anyone brave enough to
try the hostapd topology properly.

The rule for this file matches the rest of the project: a document that
describes an intention in the present tense is indistinguishable from one that
describes behaviour, and only one of them is true. If you add a row, label it
honestly.

Related: [setup/README.md](setup/README.md) for the universal shape,
[setup/PROMPTS.md](setup/PROMPTS.md) for the copy-and-paste prompts that drive
an agent through the build, and your platform guide in [setup/](setup/) for the
manual path.
