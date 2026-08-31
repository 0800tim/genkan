# Prior art + how this differs

Researched 2026-08-27 before building, per the open-source intent. Many
"bearded tech dad" projects exist; we borrow the good ideas and improve on
the weak spots. Everything marked as ours below has since been built.

## What's out there

- **jonas5/openwrt_parental_control** - per-day schedules as 96x 15-min
  slots, enable/disable in a web UI, iptables rules from the timetable.
  Good idea we adopt: the 15-min-slot schedule model.
- **k-szuster/luci-access-control** - block a MAC permanently or on a
  schedule; a LuCI firewall app. Same core idea as ours.
- **gl-inet/parental-control** - device groups with schedule-driven
  policies (ships in GL.iNet firmware). Matches our per-child groups.
- **geekinthesticks/parental-control** - OpenDNS + Squid + Shorewall for
  content filtering. The DNS-filter pattern; we use AdGuard Home instead.
- GitHub topic `parental-control` and the OpenWrt/GL.iNet forum threads.

## Why ours is different (and, for our goal, better)

1. **Dedicated isolated segment, not MAC rules on the main LAN.** Modern
   phones randomise their WiFi MAC, which quietly defeats MAC-based
   blocking. By making the kids their own segment behind the Genkan box, we
   block by reserved IP on a network we fully control, and phone MAC
   randomisation can't dodge it.
2. **DNS is forced.** All :53 is redirected to our resolver and DoT/DoH is
   blocked, so a kid can't set 8.8.8.8 or a DoH browser to bypass filtering.
3. **Real datastore + audit.** Postgres logging (devices, DNS, alerts,
   every on/off action) instead of ephemeral router state. The firewall is a
   projection of that database, reconciled every fifteen seconds, so a restart
   cannot silently forget that a child is switched off.
4. **Agent-driven, natural language.** "Turn off Ben's internet", "kill
   Ben's gaming", "dinner" - spoken to the always-on assistant, not a
   fiddly router UI.
5. **Age-tiered by design.** Different policy for 11 / 14 / 16, not one
   blunt filter for everyone.
6. **Safety-first allowlist.** Youth help lines stay reachable even when a
   kid is "off", enforced in the firewall rather than merely intended.
7. **Per-category time, not just on and off.** Because the gateway is the
   resolver, traffic is tagged by category and by named service without any
   decryption, so gaming can stop while homework and Spotify keep working, and
   the numbers reported are measured bytes rather than guesses.
8. **Smart home is a separate class.** Cameras, locks and speakers are
   classified apart from personal devices and are never cut when the kids are
   paused. Most parental controls have no concept of this and take the front
   door offline at bedtime.

## Kin project

**unrot** (0800tim/unrot, MIT) - same family of intent: helping kids resist
the attention economy, self-hosted, no telemetry, no monetisation. This
project shares that ethos. Where unrot works on the device (earn screen
time by studying), Genkan works at the network layer (who, what, when).
They complement each other.
