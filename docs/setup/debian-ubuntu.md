# Hearth on Debian or Ubuntu

For a Debian or Ubuntu server, a mini PC, or a retired laptop. This is the
most common "hardware we already had" path after the Raspberry Pi. It is
written for an AI agent to execute with you supervising; every step also
works by hand.

Read [README.md](README.md) in this directory first for the universal
shape and the shared steps (database, deploy, segment guard).

## Hardware checklist

- Any 64-bit machine with 4GB+ RAM and wired ethernet. A used 1-litre
  tiny PC (ThinkCentre, OptiPlex Micro, EliteDesk Mini) is the reference
  target: silent, 10 to 15 watts idle. An old laptop is fine too and its
  battery is a free UPS.
- A second network path for the kids' side: a USB gigabit ethernet dongle
  (RTL8153 or AX88179 chipset, roughly NZD 20-45), a second onboard NIC if
  the box has one, or a spare PCIe card.
- An access point for the kids' WiFi: an old router flipped to AP/bridge
  mode is ideal. (A laptop's own radio can broadcast the network via
  hostapd; the honest caveats and the full recipe are in the topology A
  section of [raspberry-pi.md](raspberry-pi.md) and apply unchanged here,
  with the extra warning that Intel laptop chipsets do AP mode on 2.4GHz
  only and Broadcom mostly not at all.)
- Debian 12+ or Ubuntu Server 22.04+ installed, SSH access, sudo.

BIOS tip for desktops: set "restore power on AC loss" so the gateway comes
back from a power cut on its own. Laptop tip: ignore the lid, see below.

## Step 1: packages

    sudo apt update
    sudo apt install -y git nftables openssl curl

    # Docker Engine + compose plugin, Docker's official path:
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    # log out and back in so the docker group applies

(Ubuntu's `docker.io` + `docker-compose-v2` apt packages also work if you
prefer distro packages. Avoid the Docker snap; its confinement fights the
NIC handover.)

Host `nftables` is only there so `deploy.sh` can validate the ruleset
before building. The live firewall runs inside the gateway container's
own network namespace and never touches the host's.

## Step 2: IP forwarding, persistently

Docker normally switches `net.ipv4.ip_forward` on itself, but hardened
images and some cloud bases pin it off, and a sysctl that silently flips
after a kernel update is a miserable thing to debug. Make it explicit:

    echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-hearth.conf
    sudo sysctl --system

## Step 3: the kids' NIC

Plug in the dongle (or identify the second NIC) and note its MAC from
`ip -o link show`. Copy `config.env.example` to `config.env` and set
`KIDS_NIC_MAC` to it, and `UPLINK_IFACE` to your uplink interface name
(`ip route show default` tells you).

The host must leave that interface alone so the NIC warden can hand it
into the container. Which knob depends on what manages your network:

**NetworkManager** (desktop installs, some Ubuntu variants). Create
`/etc/NetworkManager/conf.d/99-hearth-kids-nic.conf`:

    [keyfile]
    unmanaged-devices=mac:<the kids NIC MAC, lower case>

Then `sudo systemctl reload NetworkManager`. The repo's
`install/omarchy-setup.sh` writes exactly this drop-in on any distro with
nmcli, despite its name.

**systemd-networkd** (Debian server, Ubuntu Server with netplan's default
backend). An interface no `.network` file matches is already left alone.
If you have a catch-all match (netplan often generates one for `en*`),
pin the kids' NIC out of it with
`/etc/systemd/network/05-hearth-kids-unmanaged.network`:

    [Match]
    MACAddress=<the kids NIC MAC>

    [Link]
    Unmanaged=yes

Then `sudo networkctl reload`. On netplan systems also make sure the
netplan YAML does not name the kids' interface at all.

Cable the kids' NIC to a switch or straight to the access point. The AP
must be in AP/bridge mode, its own DHCP off, factory reset if it used to
be a router, and never cabled to the main LAN. The segment guard checks
this before serving, and refuses a noisy wire.

## Step 4: ufw and host firewalls

Good news first: Hearth was designed so you do not have to touch ufw. The
gateway's firewall, NAT and DHCP all live inside the container's private
network namespace. Once the warden hands the kids' NIC into the container,
the host firewall never sees island traffic at all. Leave ufw exactly as
it is.

The real gotcha, which we hit ourselves: **any kids-side interface that
stays on the host is a different story.** That happens in the WiFi-AP
topology (hostapd plus a `br-kids` bridge on the host) and during
pre-deploy testing on the raw NIC. Docker loads the `br_netfilter` module,
which makes bridged frames traverse the host's iptables, so ufw's default
deny silently eats the kids' DHCP broadcasts: devices join the WiFi and
never get an address, with nothing obvious in any log. If you run the
bridge topology with ufw enabled, allow the island's traffic on that
interface:

    sudo ufw allow in on br-kids

(or at minimum DHCP: `sudo ufw allow in on br-kids to any port 67 proto
udp`). The pure two-NIC topology needs none of this.

## Step 5: laptop-as-gateway extras

- Keep it awake with the lid closed. In `/etc/systemd/logind.conf` set:

      HandleLidSwitch=ignore
      HandleLidSwitchExternalPower=ignore

  then `sudo systemctl restart systemd-logind`.
- Mask suspend so a desktop environment cannot sleep the gateway:

      sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

- Leave it on mains. The battery then rides through power cuts.

## Step 6: database, deploy, agent

Provision Postgres and load the schema per "The database" in
[README.md](README.md) and [../DATABASE.md](../DATABASE.md). Copy
`secrets.env.example` to `secrets.env` and set both DB URLs. Then:

    cd ~/genkan
    sudo ./deploy.sh

The agentic path, and the one we recommend: clone the repo, start your
agent in it, and say:

> Read CLAUDE.md and docs/setup/debian-ubuntu.md. Set this box up as our
> Hearth gateway: install what is missing, keep the host network manager
> off the kids' NIC, provision the database per docs/DATABASE.md, run
> deploy.sh, then verify. Show me anything you run with sudo, and stop
> and ask if a verification step fails.

## Verification

    docker ps                              # hearth-gw, hearth-adguard, hearth-portal, postgres
    docker logs hearth-gw | tail -20       # "safe to own it", "firewall loaded", "island is UP"
    systemctl status kids-nic-warden       # active; "handover done" in the journal
    kidnet status && kidnet allow-status   # CLI works, safety net populated
    sudo test/container-test.sh            # the full 26-check proof
    sudo ufw status                        # unchanged, exactly as you left it

Then join the kids' network from a phone: a `192.168.60.x` lease, working
internet, the portal at `http://192.168.60.1`, and an adult domain
blocked. AdGuard's admin UI is at `http://127.0.0.1:8853` on the host
(SSH tunnel or tailnet; credentials in `secrets.env`).

## Troubleshooting

- **No DHCP lease on the kids' side.** Work the chain: is `kids0` inside
  the container (`docker exec hearth-gw ip link show kids0`)? Did AdGuard
  restart after the handover (the warden does this about 20 seconds after;
  `docker logs hearth-adguard`)? On a host-side bridge, is ufw eating the
  broadcasts (step 4)? Is the AP secretly still running its own DHCP?
- **Segment guard tripped.** Working as designed: the AP is still bridged
  to the house LAN or still serving DHCP. Factory reset it, AP/bridge
  mode, DHCP off. Detail lands in the alerts table.
- **Warden never hands the NIC over.** `journalctl -u kids-nic-warden -f`
  while you replug the dongle. Nearly always a MAC mismatch between
  `config.env` and `ip -o link show`.
- **NetworkManager keeps grabbing the NIC.** `nmcli device` should show it
  `unmanaged`. If not, the drop-in's MAC is wrong or NM was not reloaded.
  On netplan systems, check no YAML stanza names the interface.
- **Docker snap weirdness** (Ubuntu). `nsenter` and netns handover fail
  under the snap's confinement. Remove it and install Docker from
  get.docker.com or apt.
- **Island dies after a distro upgrade.** Re-run `sudo ./deploy.sh`; it is
  idempotent. Check `systemctl is-enabled docker kids-nic-warden` both say
  `enabled`.
