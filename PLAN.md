# Topology, and the honest limits of network monitoring

What the island physically looks like, and what a network-layer tool can and
cannot see. This began as the build plan before anything existed. The build is
done, so what survives here is the part that stays true: the shape of the
network, and the boundary of what it can know.

Status: built and deployed. The reference household has been running it since
2026-08-29. What each piece does day to day is in
[docs/OPERATIONS.md](docs/OPERATIONS.md); the reasoning behind each choice is in
[DECISIONS.md](DECISIONS.md).

## The shape

    Internet
      |
    your existing router                 <- untouched; your own devices stay here
      |
    Hearth box, uplink NIC               <- ordinary DHCP client on your LAN
      |  [NAT / masquerade, inside the gateway container]
    Hearth box, kids0 = 192.168.60.1/24  <- the kids' gateway
      |
    a switch, or straight to the AP
      +-- wired kids' devices
      +-- WiFi access point (AP / bridge mode) --- the kids' SSID --- phones, tablets, consoles

New subnet: `192.168.60.0/24`. The Hearth box is `.1`, and is the **single**
DHCP and DNS server for that segment. Configurable in `config.env`.

The two hard requirements:

1. **The access point must be in Access Point or bridge mode**, with its own
   DHCP and NAT off. Left in router mode it would NAT every device behind one
   address and defeat per-device control entirely.
2. **Never two DHCP servers on the island.** The gateway refuses to start if it
   hears one, which is the segment guard, and that is the single most common
   reason a first deploy will not come up. See OPERATIONS.md.

The kids' interface is named `kids0` by a udev rule generated from the MAC in
`config.env`, so it survives replugs and reboots. It carries no default route:
the default route stays on the uplink.

## Where each layer lives

Everything island-facing runs in the gateway container's network namespace:
nftables (NAT, isolation, DNS forcing, the category and service counters),
AdGuard Home (DHCP, DNS, filtering) and the kids' portal. The host runs one
warden service that hands the physical NIC in, plus the timers. The admin
dashboard runs on the host, outside the island, on your private network.

That split is the safety argument, and it is the thing the container test suite
exists to prove: a mistake in the firewall can take the kids' network down and
cannot touch the host, the main LAN or a VPN, because those interfaces do not
exist inside the container.

## Device to person mapping

Devices appear from DHCP leases, owned by nobody. A parent assigns each one
(`kidnet assign`), which sets the label, the owner and the DHCP reservation, and
immediately points AdGuard's per-child client at the right addresses so the age
tier follows the device.

Blocking is by reserved address on a network we fully control, not by MAC on the
main LAN. That matters: modern phones randomise their WiFi MAC, which quietly
defeats MAC-based blocking on an ordinary home router. On our own segment,
randomisation cannot dodge anything, because we hand out the address.

Turn "private" or "randomised" MAC **off for the kids' SSID** on each device
anyway. It is one setting, and it keeps the roster readable.

## Safety monitoring: what it can and cannot do

Set expectations here rather than anywhere else, because this is the part
people get wrong about every product in this category.

It CAN, with nothing installed on any device:

- Log every DOMAIN each device looks up, per device and per child.
- Block by category (adult, gambling, self-harm, malware, VPN and proxy), and
  enforce SafeSearch and YouTube restricted mode.
- Count real bytes and active minutes per category and per named service,
  because we are the resolver and can tag addresses without decrypting.
- Alert on genuinely concerning lookups: Tor, darknet directories, self-harm
  forums.

It CANNOT:

- Read page CONTENT or search terms. HTTPS shows the domain only. Reading
  inside would need TLS interception: a root certificate installed on every
  device, breaking pinned apps and app security. We will not do it, and any
  product that does should tell you it is doing it.
- See in-app bullying. Snapchat, Instagram and Discord messages are end to end
  encrypted and invisible here. That needs a consenting app-based tool or
  platform supervision, not the network.
- Do anything at all about mobile data. Cellular goes phone, tower, internet,
  and never comes near the house. Google Family Link (or the iOS equivalent) is
  the only lever there, and it runs alongside this rather than overlapping it.
  There is no shared API, so a bonus granted here is not granted there.
- Beat a determined VPN. A tunnel hides destination addresses, so categorisation
  and per-service accounting both fail. We block the easy routes, we alert, and
  the household bug bounty turns the attempt into a conversation.

The recommended posture is category filtering, SafeSearch, and alerts on the
serious categories, not full surveillance. Being open with the kids that the
network is filtered works better than covert monitoring, and it is the whole
reason the bug bounty exists.

## Resilience

- If the Hearth box reboots or the Docker daemon restarts, the island drops
  briefly and comes back on its own. The house internet through your own router
  is unaffected. That is the designed worst case: kids offline, house untouched.
- Nothing is held in memory. The firewall is a projection of the database,
  reconciled every fifteen seconds, so a restart or a USB replug cannot silently
  forget that a child is switched off.
- If Postgres is unreachable, the gateway keeps its last known good sets rather
  than emptying them. A stale allowlist beats a kid who cannot reach a help line.
