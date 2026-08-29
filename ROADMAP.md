# Roadmap, and where you could help

Hearth is not a monitoring product. It is a **regulator and a teacher**: it
helps a family agree how much is enough, makes the boundary hold without an
argument every night, and lets kids earn their way back through learning
rather than pleading. Every feature below should be judged against that. If
something would make a parent feel like a watcher rather than a parent, it does
not belong here.

This document is deliberately honest about what is built, what is half built,
and what is only an idea, because the fastest way to get help is to say where
the holes are.

---

## Built and in daily use

- Containerised gateway with proven isolation (a bad rule cannot reach the
  host, the main LAN or a VPN, and there is a packet-level test that proves it)
- Per-child age tiers, per-category control (gaming, video, social) via DNS
- Per-category active-time metering with daily budgets, and per-category grants.
  Downloads are split out from gaming, counted and deliberately never charged
- A seeded domain map: about 175 category domains and 30 services over 103
  domains, so a fresh install meters something on day one
- Per-service byte accounting (YouTube, Netflix, Roblox and friends), measured
  from real firewall counters rather than guessed from lookups
- Learn to earn: eight quiz banks, server-side grading, cooldowns and daily caps
- Chore claims with parent approval
- Captive portal that explains, and a warm "come and talk to me" page for the
  serious categories
- Device discovery and classification (personal, smart home, unrestricted
  appliance, infrastructure), so pausing the kids never darkens a camera, a door
  lock or the media server. Presence is read from the gateway's neighbour table,
  so "online" means on the wire rather than holding a lease
- Tor and darknet blocking with a daily relay refresh
- Safety net: NZ youth help lines stay reachable through any block
- Analytics dashboard: tonight, live traffic, family, week, trends, learn to
  earn, devices, per kid, and the health of the box itself
- A speed test on the island, measuring the wifi leg and the internet leg
  separately, proxied into the dashboard at `/speed`
- Two public demos running the real code against an invented household:
  `hearth-demo.appspurt.dev` and `hearth-portal.appspurt.dev`
- Household bug bounty

## Half built, and honest about it

| Thing | State |
|---|---|
| Tor attempt alerts | The firewall counts attempts by IP but nothing reads the counters yet, so a parent is not told. The DNS side does alert. |
| Scheduled bedtimes | The `schedules` table exists and nothing reads it. Bedtimes are manual. |
| Voice assistant | Designed in detail (`voice/`), including the impersonation Easter egg, but not built. |
| Weekly digest delivery | The page and the CLI exist; nothing emails or messages it to you yet. |
| Social metering | `METERING.md` says social is not metered; the dashboard counts it. Needs a deliberate decision either way. |
| Household IoT policy | The model, the generator and 39 packet-level tests are real, and it is installed with its timer left disabled on purpose. It was also, until 2026-08-29, storing none of the vendor addresses it resolved, so every restricted device had an empty allowlist and was not restricted at all. Fixed, but nobody has yet run it enforcing for long enough to say what it breaks in an ordinary house. |
| Vendor cloud lists | `vendor_clouds` covers a handful of brands. A device whose brand Hearth cannot identify is not restricted, and now says so on the dashboard. Adding a brand is a database row. |

---

## Good places to start

These are real gaps, sized roughly, and each is genuinely useful.

### Small, self contained

- **Quiz banks.** The highest value contribution in the project and it needs no
  networking knowledge at all. Plain JSON, see `portal/quizzes/FORMAT.md`. A
  teacher who writes a good fractions bank has done more for this project than
  most code changes.
- **Curriculum for your country.** `docs/runbooks/curriculum-generation.md` is
  written to be handed to your own AI agent. UK, Australia, Canada, the US,
  Ireland, India, South Africa, anywhere. The runbook does the research; you
  check the answers.
- **Translations.** The kid-facing portal is the part that matters most.
- **Vendor detection.** `bin/kidnet-classify` guesses what a device is from its
  hostname and MAC. Add the devices your house has.
- **Service definitions.** `config/db/schema-services.sql` maps domains to
  services. Regional streaming services are entirely missing.

### Medium

- **Bedtime schedules.** The table is there, the CLI is there, nothing joins
  them. A systemd timer reading `schedules` and calling `kidnet` would close it.
- **Digest delivery.** Email, Matrix, Signal, ntfy, whatever you use. It should
  be a small pluggable sender, not a hardcoded one.
- **Tor attempt alerting.** Read the `tor_dev` nft counters, raise an alert,
  reset. The category meter does exactly this pattern already, so copy it.
- **A kid-facing view of their own goals.** Right now goals are visible to
  parents only, which cuts against the transparency the project claims.
- **More platform guides.** OpenWrt, Proxmox, NixOS, TrueNAS, a Synology.

### Larger

- **The voice assistant** (`voice/`). Local wake word, local speech to text,
  speaker identification, and a phone notification for every voice-granted
  action. The design is written; the implementation is not.
- **Home automation.** The gateway already knows every smart device in the
  house. Home Assistant integration is an obvious neighbour.
- **A second AP topology.** Running the kids' network on a laptop's own WiFi
  via hostapd is documented but never tested on real hardware.
- **Per-app control on the device.** The network cannot see inside apps. A
  consenting companion app could, and would need to be as privacy-respecting as
  the rest of this.

---

## Things we will not do

Worth stating plainly, because they get requested.

- **TLS interception.** Reading the content of encrypted traffic would mean
  installing a certificate on every device and breaking app security. It is
  also the line between regulating and spying. No.
- **Uploading anything anywhere.** No telemetry, no crash reports, no
  "anonymous usage statistics". The moment this project holds a copy of
  anyone's browsing, it has become the thing it exists to avoid.
- **Covert monitoring features.** Hidden logging, stealth mode, reading
  messages. If a feature only works when the kid does not know about it, it is
  the wrong feature. Tell them the network is filtered. It works better anyway.
- **A paid tier, or a cloud service.** There is nothing to buy and nothing to
  subscribe to.

## How to help

Open an issue and say hello, or just send a pull request. See CONTRIBUTING.md
for what a change must not weaken (the four safety properties), and SECURITY.md
if you found a way around the filter rather than a bug in it.

If you are a parent who got this running, the most useful thing you can do is
tell us where it was annoying, and what your kids did to get around it.
