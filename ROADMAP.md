# Roadmap, and where you could help

Genkan is not a monitoring product. It is a **regulator and a teacher**: it
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
- Learn to earn: over 40 quiz banks and more than 2,000 questions, NZ Years 1
  to 3 through NCEA across every learning area, plus the UK, the US, Australia,
  Canada and Ireland, every question carrying an explanation and a difficulty.
  Server-side grading, cooldowns, daily caps and a perfect-round
  bonus, all of them settings rather than constants, per household and per child
- A difficulty ramp: every question rated 1 to 5, every round built easy to hard
  and adapted to that child's recent form, always opening on warm-ups and always
  passable
- A study page per bank ("Read up"): every question, its answer and its
  explanation, with no cooldown and no cap because reading earns nothing
- A reading list that survives a total cut: around 40 reference sites a child
  can still reach when they are out of time, kept in a scope of its own so
  trimming it can never trim the safety net
- A parent can write and edit their own quiz banks in the dashboard, stored in
  the database so a software update cannot delete them, and see each bank's pass
  rate and its worst questions
- Badges: personal milestones, and a house board that is deliberately not a
  leaderboard. Off by default
- Chore claims with parent approval
- Captive portal that explains, and a warm "come and talk to me" page for the
  serious categories
- Device discovery and classification (personal, smart home, unrestricted
  appliance, infrastructure), so pausing the kids never darkens a camera, a door
  lock or the media server. Presence is read from the gateway's neighbour table,
  so "online" means on the wire rather than holding a lease
- Tor and darknet blocking with a daily relay refresh
- Device claiming: a device nobody owns gets DNS, the portal and the safety net
  and nothing else, and a child's own claim grants nothing until a parent
  confirms it. Off by default, with an observe mode
- Safety net: NZ youth help lines stay reachable through any block
- Analytics dashboard: tonight, live traffic, family, week, trends, learn to
  earn, devices, per kid, and the health of the box itself
- A speed test on the island, measuring the wifi leg and the internet leg
  separately, proxied into the dashboard at `/speed`
- Two public demos running the real code against an invented household:
  `demo.genkan.nz` and `quiz-demo.genkan.nz`
- Nine test suites, including one that loads every schema file into an empty
  database because a fresh install was the thing nothing tested, and one that
  proves a Friday night, a morning restore and a restart mid-bedtime without
  waiting for any of them
- Household bug bounty

## Half built, and honest about it

| Thing | State |
|---|---|
| Tor attempt alerts | The firewall counts attempts by IP but nothing reads the counters yet, so a parent is not told. The DNS side does alert. |
| Scheduled bedtimes | Built (2026-08-30). Per child, separate school-night and weekend times, a holiday window, tonight's extension, and a morning restore that lifts only what the schedule itself applied. What it cannot do: it does not know about a term calendar, and it cannot make a bedtime conditional on anything (homework done, who is home). |
| Voice assistant | Designed in detail (`voice/`), including the impersonation Easter egg, but not built. |
| Weekly digest delivery | The page and the CLI exist; nothing emails or messages it to you yet. |
| Social metering | `METERING.md` says social is not metered; the dashboard counts it. Needs a deliberate decision either way. |
| Household IoT policy | The model, the generator and 39 packet-level tests are real, and it is installed with its timer left disabled on purpose. It was also, until 2026-08-29, storing none of the vendor addresses it resolved, so every restricted device had an empty allowlist and was not restricted at all. Fixed, but nobody has yet run it enforcing for long enough to say what it breaks in an ordinary house. |
| Vendor cloud lists | `vendor_clouds` covers a handful of brands. A device whose brand Genkan cannot identify is not restricted, and now says so on the dashboard. Adding a brand is a database row. |
| Paying for learning rather than recall | The reading list and the study pages mean a child can now genuinely go and learn before a round. Genkan still pays them exactly the same as a child who guessed well. The signals exist (`dns_log`, `quiz_study_visits`, `quiz_answers`, and the difficulty of every question served) and nothing prices any of them. `LEARN-TO-EARN.md` holds the open question. |
| Curriculum coverage | Over 40 banks is a real curriculum and it is not an even one. Every New Zealand learning area has at least one bank now, but depth varies: maths has one per year band and te reo Māori has a single beginners bank. Languages beyond te reo have nothing, and no country outside NZ, the UK, the US, Australia, Canada and Ireland is covered. It is also not validated against any syllabus document, and nobody should say otherwise. |
| Getting a bank into the dashboard | A parent types a database bank in one question at a time. There is no bulk import, so a whole bank written as JSON has to go in as a file through `genkan-quiz install`. |
| Device claiming in a real house | Off by default, with observe mode, 5 packet-level checks and the reasoning written up. Nobody has yet run it enforcing for a month in a house full of guests, so what it costs in day-to-day annoyance is genuinely unknown. |

---

## Good places to start

These are real gaps, sized roughly, and each is genuinely useful.

### Small, self contained

- **Quiz banks.** Still the highest value contribution in the project and it
  needs no networking knowledge at all. Plain JSON, see
  `portal/quizzes/FORMAT.md` and the explanation-writing guidance in
  `CONTRIBUTING.md`. The gaps are the point now that there are over 40 banks:
  depth in te reo Māori, languages beyond it, and anything outside the six
  countries covered.
- **Curriculum for your country.** New Zealand, the UK, the United States,
  Australia, Canada and Ireland have banks. India, South Africa, Singapore and
  everywhere else do not. `docs/runbooks/curriculum-generation.md` is written to
  be handed to your own AI agent: the runbook does the research, you check every
  answer.
- **Add to the reading list.** Around 40 sites, and the rule that keeps it
  useful is that it stays dull. `docs/READING-LIST.md` has the five tests and
  the well-known school sites that failed them, which is the part worth reading
  before you propose one.
- **Translations.** The kid-facing portal is the part that matters most.
- **Vendor detection.** `bin/genkan-classify` guesses what a device is from its
  hostname and MAC. Add the devices your house has.
- **Service definitions.** `config/db/schema-services.sql` maps domains to
  services. Regional streaming services are entirely missing.

### Medium

- **Digest delivery.** Email, Matrix, Signal, ntfy, whatever you use. It should
  be a small pluggable sender, not a hardcoded one.
- **Tor attempt alerting.** Read the `tor_dev` nft counters, raise an alert,
  reset. The category meter does exactly this pattern already, so copy it.
- **A kid-facing view of their own goals.** Right now goals are visible to
  parents only, which cuts against the transparency the project claims.
- **Price learning, not just answers.** The first pass of a bank worth more than
  the tenth, a round worth more when the child was reading about it first, a
  question they used to get wrong worth a premium. Each is a small change and
  each one is a rule a clever kid will try to optimise, so read the risk section
  in `LEARN-TO-EARN.md` before building one.
- **More platform guides.** OpenWrt, Proxmox, NixOS, TrueNAS, a Synology.

### Larger

- **The voice assistant** (`voice/`). Local wake word, local speech to text,
  speaker identification, and a phone notification for every voice-granted
  action. The design is written; the implementation is not.
- **Home automation.** The gateway already knows every smart device in the
  house. Home Assistant integration is an obvious neighbour.
- **A second AP topology.** Running the kids' network on a laptop's own WiFi
  via hostapd, which also makes the laptop's battery a free UPS for the family
  gateway. The thinking, including which chipsets can actually do AP mode, is
  in docs/HARDWARE.md under "Serving the kids' wifi straight from the box".
  Never tested on real hardware yet.
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
