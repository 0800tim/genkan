# Kids' network island: build plan

Goal: a separate wired+wireless network for the kids that clawdia is the
sole gateway for, so internet on/off (per kid, or all) is a firewall rule
clawdia owns, drivable by the agent from Tim's phone. Plus DNS-level
safety filtering and per-device domain logging.

Status: adapter found and detected 2026-08-27. Building not started (waiting
on the physical island: switch + WiFi 6 AP cabling, and the AP model).

## Hardware / interfaces (facts)

- Uplink: clawdia `enp5s0` (r8169) = 192.168.1.10,
  gateway 192.168.1.1 (ASUS). UNCHANGED by this build.
- Kids' gateway NIC: USB ASIX AX88179, interface `enx000ec6cccd56`
  (mac <your-adapter-MAC>, driver ax88179_178a). Stable-named `kids0`
  via udev (rule written 2026-08-27). "down" until cabled to the switch.
- Spare unmanaged switch (Tim has) = the wired backbone of the island.
- WiFi 6 AP: TP-Link Deco X20 (AX1800), set to ACCESS POINT mode (its own
  DHCP/NAT OFF) so it is a dumb bridge; hangs off the switch and broadcasts
  the kids' SSID. NOTE: consumer Deco is app-only (no web UI / SSH / local
  API). The agent cannot manage the Deco. Only requirement: Tim flips it to
  AP mode once via the Deco app and names the SSID (e.g. kids-wifi). After
  that it is a radio and clawdia owns all logic. Do NOT leave it in router
  mode (it would NAT + hide devices behind one IP and defeat per-device
  control).
- Son's desktop: wired into the same switch.

## Topology

    Internet
      |
    ASUS 192.168.1.1
      |
    clawdia enp5s0 (192.168.1.10)      <- uplink, unchanged
      |  [NAT / masquerade]
    clawdia kids0 = 192.168.60.1/24      <- kids' gateway
      |
    spare switch (wired)
      +-- son's desktop (wired, DHCP from clawdia)
      +-- WiFi 6 AP (AP/bridge mode) --- kids' SSID --- phones/tablets

New subnet: 192.168.60.0/24. clawdia = .1 (gateway, DNS, DHCP).

Confirmed cabling (Deco X20 has 2 gigabit ports; in AP mode both ports +
WiFi are ONE bridged segment):
  Deco port 1 -> clawdia kids0 (uplink to gateway)
  Deco port 2 -> spare switch -> wired kids' devices (desktop, etc.)
  Deco WiFi   -> wireless kids' devices
Equivalent alt: kids0 -> switch (as hub); switch -> Deco (one port only,
no loop) + desktop + other wired. Same L2 segment either way.
DHCP: clawdia is the SINGLE DHCP+DNS server for the island. Deco in AP mode
runs neither (that is the point of AP mode). Never leave two DHCP servers on.

## Software layers on clawdia

1. Interface + address: udev names it `kids0`; static 192.168.60.1/24 via
   systemd-networkd (or netplan). No default route on kids0.
2. NAT: nftables masquerade 192.168.60.0/24 -> enp5s0. ip_forward already 1.
3. DHCP + DNS: AdGuard Home (Docker, bound to 192.168.60.1:53 + a UI port)
   RECOMMENDED over plain dnsmasq because it gives: per-client query logs
   (the "what sites" view), category blocklists (adult/gambling/self-harm/
   malware), SafeSearch + YouTube-restricted enforcement, and schedules,
   all with a UI. DHCP can be AdGuard's or a small dnsmasq; hand out
   .60.1 as gateway+DNS. Per-device DHCP reservations give each kid device
   a stable IP for grouping.
4. On/off control: nftables `kids_block` set of blocked IPs; a device in
   the set has its forward traffic dropped = internet off instantly.
   Script `kidnet` (to write): `kidnet off Ben|Cleo|all`,
   `kidnet on ...`, `kidnet status`. Agent runs it when Tim says
   "turn off Ben's internet" etc. from his phone.
5. Schedules: systemd timers (e.g. off 21:00, on 07:00) calling `kidnet`.

## Device -> kid mapping

Captured once devices join (DHCP leases show up under kids0). Groups so
far named: Ben, Cleo (+ son with the wired desktop + Android phone).
On the kids' own SSID, MACs are stable per-network even if "private MAC"
is on, but set private/random MAC OFF for that one SSID on each device to
be safe. Reserve a fixed .60.x per device and block by IP.

## Safety monitoring: what it can and cannot do (set expectations)

CAN (network layer, nothing installed on devices):
- Log every DOMAIN each device visits; flag/alert/block by category
  (porn, gambling, self-harm, known-bad). Enforce SafeSearch + YouTube
  restricted. Good coverage of the "dodgy sites" goal.
CANNOT:
- Read page CONTENT or search terms: HTTPS shows the domain only. Reading
  content needs TLS interception (root cert on each device + MITM), which
  is invasive and breaks pinned apps; only if Tim explicitly wants it.
- See in-app bullying: Snapchat/Instagram/Discord DMs are end-to-end
  encrypted. Network monitoring can't see them. That needs a consenting
  app-based tool (e.g. Bark) or platform supervision, not the network.
Recommended posture: category filtering + SafeSearch + alerts on serious
categories, NOT full surveillance. Being open with the kids that the
network is filtered tends to work better than covert monitoring.

## Mobile data (separate problem, not network-solvable)

Son's Android cellular never touches home WiFi. Only Google Family Link
(pause device / downtime, works over cellular) controls it. One-time
setup linking his Google account to Tim's; the agent can't press the
button but can write the setup guide. Bark can ride alongside for the
in-app safety signals.

## Resilience notes

- If clawdia reboots, the kids' island drops (fail-closed). Main house
  internet via the ASUS is unaffected. Acceptable, but note it.
- Persist: udev name (done), networkd static, nftables ruleset at boot,
  AdGuard/dnsmasq as services.

## Open items before/at build

- Deco X20 flipped to Access Point mode via the Deco app + kids SSID set (Tim, one-time).
- Physically cable: kids0 -> switch -> {AP, son's desktop}.
- Confirm AdGuard Home vs plain dnsmasq (recommend AdGuard Home).
- Family Link go-ahead + guide.
- Capture device inventory, set reservations, name per-kid groups.
