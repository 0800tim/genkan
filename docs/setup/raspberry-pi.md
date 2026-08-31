# Genkan on a Raspberry Pi

The "any old hardware" build. A Raspberry Pi in a drawer is enough to run
your whole family's filtered, time-budgeted network. This guide covers the
Pi 3, 4 and 5 on Raspberry Pi OS, both wired and WiFi topologies, and is
written for an AI agent to execute with you supervising.

Read [README.md](README.md) in this directory first for the universal
shape and the shared steps (database, deploy, segment guard).

## Which Pi

| Model | Verdict | Why |
|---|---|---|
| Pi 5 | Recommended | Gigabit ethernet, fast USB 3.0 for a second NIC, ample CPU. |
| Pi 4 (2GB+) | Recommended | Gigabit ethernet, USB 3.0. The sweet spot for a used buy. |
| Pi 3 / 3B+ | Works, with limits | 100Mbit ethernet on a shared USB 2.0 bus. Honest numbers below. |
| Pi Zero / Pi 2 | No | Not enough interfaces or grunt. |

**Pi 3 honesty.** The Pi 3's ethernet is 100Mbit and it shares one USB 2.0
bus with every USB port. With ethernet as uplink and the onboard WiFi as
the kids' AP you will see roughly 40 to 90 Mbps through the island, less
under load. For homework, YouTube at 1080p, music and most gaming that is
fine. For a gigabit fibre household with heavy downloaders it will feel
like the bottleneck it is. The Pi 3's WiFi is also 2.4GHz only. It is a
great way to prove Genkan with zero spend; plan to promote it to a Pi 4 or
5 (or any mini PC) if the family outgrows it.

## Choose a topology

**Topology A: built-in WiFi as the kids' access point.** Pi ethernet is
the uplink to your home router. The Pi's own radio broadcasts the kids'
WiFi via hostapd. Zero extra hardware. Honest caveats: the onboard radio
is fine for a handful of devices on 2.4GHz, has a small antenna, and tops
out around 8 to 10 clients before it gets flaky. A real access point is
better for a busy house. Treat this as the "prove it tonight" mode or a
small-family steady state.

**Topology B: USB ethernet dongle as the kids' wired leg.** Pi ethernet is
the uplink; a USB gigabit ethernet dongle (RTL8153 or AX88179 chipset,
roughly NZD 20-45, both plug-and-play on the Pi kernel) feeds a switch or
a real access point in AP/bridge mode. This is the better steady state:
proper WiFi coverage, wired consoles, and the Pi just routes.

You can also start with A and add B later without reinstalling anything.

## Hardware checklist

- Raspberry Pi 3, 4 or 5 with the official power supply (undervoltage
  causes exactly the flakiness you do not want on a gateway).
- A microSD card, 16GB or larger, A1-class or better. (Pi 4/5: a USB SSD
  is even better; SD cards wear out under Postgres.)
- Ethernet cable from the Pi to your home router.
- Topology B only: a USB gigabit ethernet dongle, plus a switch or an
  access point (an old router flipped to AP/bridge mode is ideal).
- Another computer to flash the SD card from.

## Step 1: flash Raspberry Pi OS (headless)

Use Raspberry Pi Imager on any computer:

1. Choose **Raspberry Pi OS Lite (64-bit)**. No desktop needed; this box
   is an appliance. (Pi 3: 64-bit Lite works and is what Docker wants.)
2. In the Imager's customisation (the gear icon, or Ctrl+Shift+X): set a
   hostname (e.g. `genkan`), enable SSH with your key or a password, set
   your username, and set the **WiFi country** (e.g. NZ). The country
   setting matters even if you skip WiFi credentials: without it the radio
   stays rfkill-blocked and hostapd cannot start.
3. Do not join the Pi to your house WiFi. The uplink is ethernet.

Boot the Pi with ethernet plugged into your router, find its IP from your
router's client list (or `ssh genkan.local`), and SSH in.

## Step 2: base packages and Docker

    sudo apt update && sudo apt full-upgrade -y
    sudo apt install -y git nftables openssl curl

    # Docker Engine + compose plugin (Docker's official convenience script)
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    # log out and back in so the docker group applies

`nftables` on the host is only for `deploy.sh` to validate the ruleset
before building; the live firewall runs inside the container.

**Enable the memory cgroup** (Raspberry Pi OS ships with it off; Docker
wants it for container memory limits). Append to the single line in
`/boot/firmware/cmdline.txt` (older releases: `/boot/cmdline.txt`):

    cgroup_enable=cpuset cgroup_enable=memory cgroup_memory=1

Then `sudo reboot`. The whole file must remain one line.

## Step 3: clone the repo, hand it to your agent

    git clone <genkan repo url> ~/genkan && cd ~/genkan

The agentic path, and the one we recommend: start your agent (`claude`, or
whichever you use) in the repo and say:

> Read CLAUDE.md and docs/setup/raspberry-pi.md. Set this Pi up as our
> Genkan gateway using topology A (the Pi's own WiFi as the kids' access
> point). Provision the database per docs/DATABASE.md, work step by step,
> and stop and ask me if any verification step fails.

Swap "topology A" for B as appropriate. The rest of this guide is what the
agent (or you) does.

## Step 4: the database

Follow "The database" in [README.md](README.md): a `postgres` container on
a `postgres` Docker network, then schema load per
[../DATABASE.md](../DATABASE.md), then set `KIDS_DB_URL` and
`KIDS_DB_URL_DOCKER` in `secrets.env` (copy `secrets.env.example`).

## Step 5A: topology A, the Pi's radio as the kids' AP

Genkan's containment model does not change here. The gateway container
still owns `kids0`; the only host-side additions are hostapd (which must
sit where the radio driver is) and a bridge that carries WiFi frames to a
virtual cable into the container:

    kid device )) wlan0 (hostapd) -> br-kids -> vk-host <=> vk-kids
                                            (handed into the container as kids0)

DHCP, DNS, filtering and the firewall all stay inside the container.
AdGuard's DHCP answers arrive on the WiFi through the bridge.

**A note on dnsmasq.** Every classic "Pi as access point" guide pairs
hostapd with dnsmasq and host NAT rules. Genkan replaces both: AdGuard in
the container is the island's only DHCP and DNS server, and NAT lives in
the container's own nftables ruleset. Do not install dnsmasq. If this Pi
previously followed such a guide, disable it first:

    sudo systemctl disable --now dnsmasq 2>/dev/null || true

### 5A.1 The bridge and virtual cable

Create `/etc/systemd/system/genkan-kids-bridge.service`:

    [Unit]
    Description=Genkan kids bridge + veth pair (WiFi AP topology)
    Before=kids-nic-warden.service hostapd.service
    Wants=network-pre.target

    [Service]
    Type=oneshot
    RemainAfterExit=yes
    ExecStart=/usr/sbin/ip link add br-kids type bridge
    ExecStart=/usr/sbin/ip link add vk-host type veth peer name vk-kids
    ExecStart=/usr/sbin/ip link set vk-kids address 02:68:65:61:72:74
    ExecStart=/usr/sbin/ip link set vk-host master br-kids
    ExecStart=/usr/sbin/ip link set br-kids up
    ExecStart=/usr/sbin/ip link set vk-host up
    ExecStart=/usr/sbin/ip link set vk-kids up
    ExecStop=/usr/sbin/ip link del vk-host
    ExecStop=/usr/sbin/ip link del br-kids

    [Install]
    WantedBy=multi-user.target

Then:

    sudo systemctl daemon-reload
    sudo systemctl enable --now genkan-kids-bridge.service

`02:68:65:61:72:74` is a fixed locally-administered MAC. It is how the NIC
warden finds the container end of the virtual cable, so it goes into
`config.env`:

    cp config.env.example config.env
    # then edit config.env:
    #   KIDS_NIC_MAC=02:68:65:61:72:74
    #   UPLINK_IFACE=eth0

### 5A.2 Keep NetworkManager off our interfaces

Raspberry Pi OS (Bookworm and later) uses NetworkManager. It must not
touch the radio, the bridge, or the veth pair. Create
`/etc/NetworkManager/conf.d/99-genkan-kids.conf`:

    [keyfile]
    unmanaged-devices=interface-name:wlan0;interface-name:br-kids;interface-name:vk-*

Then reload it:

    sudo systemctl reload NetworkManager

(Older Bullseye images use dhcpcd instead: add
`denyinterfaces wlan0 br-kids vk-host vk-kids` to `/etc/dhcpcd.conf`.)

### 5A.3 hostapd

    sudo apt install -y hostapd
    sudo rfkill unblock wlan

Create `/etc/hostapd/hostapd.conf`:

    interface=wlan0
    bridge=br-kids
    driver=nl80211
    country_code=NZ
    ssid=kids-wifi
    hw_mode=g
    channel=6
    ieee80211n=1
    wmm_enabled=1
    auth_algs=1
    wpa=2
    wpa_key_mgmt=WPA-PSK
    rsn_pairwise=CCMP
    wpa_passphrase=change-me-to-a-long-passphrase
    macaddr_acl=0
    ignore_broadcast_ssid=0

Set your own `country_code`, `ssid` and a long `wpa_passphrase` (and put
the SSID in `config.env` as `KIDS_SSID`). `hw_mode=g` with `channel=6` is
2.4GHz: the reliable choice on every Pi. The Pi 4 and 5 radios can do
5GHz AP (`hw_mode=a`, `channel=36`) with a correct country code, but
2.4GHz has better range through walls and fewer driver surprises; the Pi 3
is 2.4GHz only. Point Debian's service at the config and start it:

    echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' | sudo tee -a /etc/default/hostapd
    sudo systemctl unmask hostapd

Give hostapd a systemd drop-in so it waits for the bridge and disables
WiFi power saving. Create
`/etc/systemd/system/hostapd.service.d/genkan.conf`:

    [Unit]
    Requires=genkan-kids-bridge.service
    After=genkan-kids-bridge.service

    [Service]
    ExecStartPost=/usr/sbin/iw dev wlan0 set power_save off

Then start it:

    sudo systemctl daemon-reload
    sudo systemctl enable --now hostapd

(WiFi power saving left on is a classic source of mystery dropouts on an
AP; the drop-in keeps it off.)

At this point the SSID should be visible on a phone. Joining it gets you
nothing yet: there is no DHCP server until Genkan is deployed. That is
correct, and it is also the handoff in one sentence: hostapd only moves
radio frames; addresses, DHCP, DNS and NAT all come from the container
once `deploy.sh` runs.

**Optional: standalone radio test.** If you want to prove the radio and
bridge before deploying Genkan, you can temporarily play the container's
role from the host. Temporarily is the operative word: undo all of it
before deploying, or the segment guard will (rightly) refuse the wire.

    # give the bridge the gateway address and serve DHCP the classic way
    sudo ip addr add 192.168.60.1/24 dev br-kids
    sudo apt install -y dnsmasq   # test only; remove afterwards
    sudo systemctl stop dnsmasq
    sudo dnsmasq --no-daemon --interface=br-kids --bind-interfaces \
      --dhcp-range=192.168.60.50,192.168.60.150,1h --dhcp-option=6,1.1.1.1 --port=0

    # in a second shell: NAT out the uplink
    sudo sysctl -w net.ipv4.ip_forward=1
    sudo nft add table ip genkantest
    sudo nft 'add chain ip genkantest post { type nat hook postrouting priority srcnat; policy accept; }'
    sudo nft add rule ip genkantest post ip saddr 192.168.60.0/24 oifname "eth0" masquerade

A phone on the SSID should now get a lease and browse. Then tear it down:

    # Ctrl+C the dnsmasq, then:
    sudo nft delete table ip genkantest
    sudo ip addr del 192.168.60.1/24 dev br-kids
    sudo apt purge -y dnsmasq

## Step 5B: topology B, USB ethernet dongle as the kids' leg

Much simpler. Plug the dongle in (Pi 4/5: use a blue USB 3.0 port) and
find its MAC:

    ip -o link show

Copy `config.env.example` to `config.env` and set:

    KIDS_NIC_MAC=<the dongle's MAC>
    UPLINK_IFACE=eth0

Keep NetworkManager away from it. The `install/omarchy-setup.sh` script
writes this drop-in for you on any distro with nmcli (despite the name),
or create `/etc/NetworkManager/conf.d/99-genkan-kids-nic.conf` by hand:

    [keyfile]
    unmanaged-devices=mac:<the dongle's MAC, lower case>

Then reload it:

    sudo systemctl reload NetworkManager

Cable the dongle to a switch or straight to your access point. The AP must
be in AP/bridge mode with its own DHCP off, factory reset if it used to be
the house router, and not connected to the main LAN in any way. The
segment guard checks exactly this before serving.

## Step 6: deploy

    cd ~/genkan
    sudo ./deploy.sh

`deploy.sh` validates the firewall ruleset, builds the gateway image,
installs `kidnet` and the NIC warden, and starts the stack. The warden
finds the interface matching `KIDS_NIC_MAC`, hands it into the container
as `kids0`, and the segment guard listens before the island goes live.

## Verification

    docker ps                                  # genkan-gw, genkan-adguard, genkan-portal, postgres
    docker logs genkan-gw | tail -20           # "segment guard: wire is quiet", firewall loaded
    systemctl status kids-nic-warden           # active, "handover done" in the journal
    kidnet status                              # CLI talks to the island
    kidnet allow-status                        # safety net domains resolved
    sudo test/container-test.sh                # the full 26-check proof

Then the real test: join the kids' WiFi from a phone. It should get a
`192.168.60.x` address, browse the internet, load the portal at
`http://192.168.60.1`, and have an obviously adult domain blocked. The
AdGuard admin UI is on the Pi at `http://127.0.0.1:8853` (reach it via an
SSH tunnel or your tailnet; credentials are in `secrets.env`).

## Troubleshooting

- **Phone joins the WiFi but gets no IP address.** Check the chain in
  order. Is `kids0` inside the container (`docker exec genkan-gw ip link
  show kids0`)? Did the warden restart AdGuard after the handover (it does,
  about 20 seconds later; `docker logs genkan-adguard`)? Topology A: is
  `vk-host` in the bridge (`bridge link`), and is NetworkManager really
  leaving wlan0 and the veths alone (`nmcli device`)? If the host runs ufw
  or another firewall, see the DHCP-on-bridge gotcha in
  [debian-ubuntu.md](debian-ubuntu.md); it applies to Pi OS too.
- **Segment guard tripped, island refuses to start.** Working as designed:
  something else is talking on the kids' wire. Almost always the access
  point still bridged to the house LAN or still running its own DHCP.
  Factory reset it, set AP/bridge mode, DHCP off, and only cable it to the
  kids' leg. `kidnet status` and the alerts table carry the detail.
- **Warden never hands the NIC over.** The MAC in `config.env` does not
  match. Compare `ip -o link show` against `KIDS_NIC_MAC`
  (`journalctl -u kids-nic-warden` shows what it is looking for). Note the
  warden lower-cases it; a typo'd octet is the usual culprit.
- **hostapd fails to start.** `sudo systemctl status hostapd` first. The
  usual suspects: rfkill (`sudo rfkill unblock wlan`, and confirm the WiFi
  country is set: `raspi-config nonint get_wifi_country`), NetworkManager
  still managing wlan0, the bridge unit not started, or another process
  holding the radio (`wpa_supplicant` bound to wlan0 because the Imager
  was given house WiFi credentials; remove that connection).
- **WiFi works but drops out under load.** Power saving (the drop-in above
  disables it; confirm with `iw dev wlan0 get power_save`), an undersized
  power supply (`dmesg | grep -i voltage`), or simply too many clients for
  the onboard radio. Past 8 to 10 devices, move to topology B with a real
  AP.
- **Everything is slow on a Pi 3.** Expected; see the honesty note at the
  top. Confirm with `iperf3` from a wired kid device that you are at the
  platform ceiling and not fighting a duplex or WiFi problem, then decide
  whether the family needs bigger hardware.
- **SD card corruption after a power cut.** Gateways eat power cuts. On a
  Pi 4/5, boot from a USB SSD instead; on any Pi, keep a flashed spare
  card, and note that all the state that matters is in Postgres (back the
  volume up).
