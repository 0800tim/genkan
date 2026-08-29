# How per-category time metering works

Goal: count ACTIVE minutes on time-wasters (gaming, YouTube/video, scrolling)
and DON'T count music, chess, schoolwork or talking to Dad. Then cap each
category separately (e.g. 2h gaming/day, 1h YouTube/day; music unlimited).

## The one trick that makes it possible

We can't read inside encrypted traffic, but **the Hearth box is the DNS server**, so
we see every name a device looks up and the IPs it got back. That lets us tag
otherwise-opaque traffic by category WITHOUT decrypting it:

1. Kid's device resolves `youtube.com` / `googlevideo.com` -> resolver notes
   "these IPs = category video, for this device" (table category_ips, TTL'd).
2. Device resolves a Roblox/Steam/Fortnite domain -> those IPs = gaming.
3. The firewall has per-category IP sets (nftables) filled from category_ips.

Now every flow can be attributed to a category by its destination IP, even
though the payload is encrypted. This is exactly how commercial parental tools
do it.

## Measuring "active" (not just "connected")

- nftables `counter` rules on each category set count bytes per device.
- A once-a-minute sampler reads the delta. If bytes-to-gaming this minute is
  above a small threshold -> that device gets 1 minute of GAMING counted
  (category_usage). Below threshold (idle/background keepalive) -> nothing.
- Thresholds differ by category: active Roblox/Fortnite = steady traffic;
  YouTube playing = high bitrate; a paused tab = low. So we count real use,
  not a backgrounded app.

## What is and isn't metered

| Category | Metered? | Why |
|---|---|---|
| gaming (Roblox/Fortnite/Steam/consoles) | YES | the main issue |
| video (YouTube, Shorts, TikTok, Netflix) | YES | time-wasting |
| download (game, console and OS updates) | counted, never charged | bandwidth, not screen time. See below |
| social (Insta/Snap) | no | blockable, but not counted: it overlaps video |
| audio (Spotify, Apple Music) | NO | "singing in the shower" is fine |
| schoolwork (Drive/Docs/Khan) | NO | encourage it |
| chess, messaging Dad, general web | NO | not in a metered set |

### A download is not screen time

A 60 GB console update is the biggest thing on the wire all evening and it is
not playing. Charging it to a child's gaming budget would take an afternoon off
them for something they did not do, so `download` is its own category: counted
in `category_usage`, drawn as its own band on the live chart, and deliberately
excluded from budget enforcement. Two rules separate it from play, and both are
needed:

1. **Destination.** The content-delivery names (`steamcontent.com`,
   `cs.steampowered.com`, the PSN, Xbox and Nintendo asset CDNs, OS and app
   store updates) are their own `download` rows in `category_domains`, and are
   longer domain suffixes than the gaming names they sit under. Longest suffix
   wins, so `cs.steampowered.com` is a download while `steampowered.com` stays
   gaming.
2. **Rate.** A game is a trickle and an update is a flood. More than
   `DOWNLOAD_BYTES_PER_MIN` (50 MB, about 7 Mbit/s) to a *gaming* address in
   one minute is booked as a download instead. That catches the CDN names
   nobody has listed yet. It is deliberately not applied to video, where 4K
   streaming is legitimately fast.

The same threshold is applied on the live chart, so what a parent sees and what
the meter books agree.

## What the mapper refuses to learn

Tagging an address by category is the whole basis of this, so a bad tag is not a
small error: it mis-colours every byte anybody sends to that address until it is
withdrawn. Three rules keep the map honest, and each of them costs coverage on
purpose.

**The CDN apex guard.** A content network lives on its subdomains. Its bare
apex is a front door, and a front door answers from whatever generic edge is
nearest, which is usually the same edge that serves the vendor's search, mail
and app store. So a lookup of a bare apex like `googlevideo.com` can categorise
traffic for reporting, but it can never teach the meter an address. This is not
a theoretical worry: one row learned that way, a general Google edge address
tagged `video`, booked every byte every phone in the house sent to Google as
YouTube, and the live chart correctly showed the whole family watching video all
day.

**The ambiguity guard.** An address is tagged only when, across the window just
scanned, it answered for exactly one category and for no uncategorised name at
all. An address shared with anything else is never metered, and is deleted from
`category_ips` if an earlier run had tagged it.

**Routable answers only.** A blocked query is answered with `0.0.0.0` and a
rewritten one with the portal's address. Neither is a destination anybody sends
bytes to, and learning the null address would have let one blocked domain
swallow the whole island's traffic.

The firewall then has to be able to forget. `kidnet-catmeter` **reconciles**
each category set rather than adding to it: flush and refill in one nftables
transaction, every minute, from whatever `category_ips` holds for the last 24
hours. Add-only was the third fault in the same bug, because an address the
mapper had withdrawn kept colouring traffic until the gateway container was
restarted. The gateway's own `reconcile_set` already worked this way; the meter
now matches it.

## Turning a category OFF (enforcement, separate from metering)

"Turn gaming off" = two moves on the gaming set:
1. DNS: answer gaming domains with the portal IP (so they get the "time's up"
   page, not a dead connection).
2. Firewall: drop flows to the gaming IP set.
Precise: kills Roblox/Fortnite/Steam while chess, music and homework stay up.

## Turning a category DOWN: the slow lane

A third state, between on and off, and usually the better one to reach for.

Off is a wall. The video stops, the child comes to find you, and you have the
argument the whole product exists to avoid. The slow lane is a different
lesson: the category is policed down to a few hundred kilobits, so the video
still plays and simply buffers, a page still loads, a message still sends, and
the child drifts off to something else on their own. Nobody was told no.

    kidnet slow ben video      video crawls, everything else is untouched
    kidnet full ben video      back to normal

### How it is done

In nftables, in the same ruleset as everything else, reconciled from the
database on the same fifteen-second loop. No `tc`, no second enforcement plane
to disagree with the first.

`config/nftables/kids.nft` gains four membership sets (`slow_gaming`,
`slow_video`, `slow_social`, `slow_all`) and a `throttle` chain on the forward
hook at priority 20. That puts it after the filter chain (0), so what is
dropped is never policed, and after the metering chain (10), so what is policed
is still counted. Its policy is `accept`, so a mistake in it can only ever fail
towards full speed.

Each rule polices with a `meter` keyed on the island address, which gives every
DEVICE its own token bucket rather than one shared bucket for the household.
Two throttled children get a slow lane each; they do not fight over one. Both
directions are policed, with a separate bucket each, because a limit that only
capped the upload would barely change a stream at all.

The destination sets are the same ones the meter uses, so the slow lane and the
chart can never disagree about what "video" is. Social gained a destination set
of its own (`social_ips`) for this, filled from `category_ips` by the gateway;
it carries no counter and no metering rule, so nothing about what is measured
has changed.

### The speed, and why

**256 kbit/s** by default, written in the ruleset as 32 kbytes/second with a 64
kbyte burst. Measured in the test rig, not guessed: a sustained pull settles at
250 kbit/s, and the burst lets a small page arrive at full speed before the
policer bites.

At that rate a chat message, a search result and a small page all still arrive.
YouTube at its lowest quality wants more than it, and Netflix wants about twice
it, so video cannot hold a stream and buffers instead. Gameplay is usually
under 150 kbit/s, so a game mostly still plays while everything it wants to
stream in stalls. That asymmetry is the point: small things work, big things
are miserable.

`kidnet slow-rate <kbit>` changes it, between 32 and 9999. It is stored in
`slow_settings` and the gateway re-renders the throttle chain with it on the
next reconcile.

### Running out of time: the cliff or the slope

`kidnet slow-timeout cut|slow`. `cut` is the default and is what Hearth has
always done at zero. `slow` drops the child into the whole-device slow lane
instead, so the evening tails off rather than ending mid-sentence, and earning
minutes back puts them straight back to full speed. Some families want the
cliff and some want the slope. Neither is assumed and an upgrade never changes
it.

`bin/kidnet-meter` stops spending minutes for a child already on the slope. It
has to: they are not cut, so without that their ledger would sink further into
the red every minute and earning ten minutes back would not lift them out.

### What is never slowed

- **The safety net.** `@kids_allow` is accepted at the top of the throttle
  chain in both directions, above every policing rule. A child in trouble
  reaching a help line over a deliberately crippled connection would be the
  worst failure this project could have. `test/firewall-test.sh` proves it on
  an address that is otherwise inside a throttled category.
- **Smart home, appliances and infrastructure.** The view the gateway reads
  (`slow_lane_ips`) filters on `devices.category = 'personal'`, so a camera, a
  smart lock or the access point can never appear in a throttle set, even if
  the device has somehow been handed to a child. `test/schema-test.sh` proves
  that one.
- **The portal, DNS, DHCP and the speed test.** They are on the input hook, not
  the forward hook, so the page that explains the slow lane is always full
  speed. A slow network that says nothing is just a broken network.

### Honest limits of the slow lane

- It polices by destination address, exactly like the meter, so it inherits
  every limit in the list below: a VPN hides the destination and escapes it, a
  service whose CDN is not in `category_domains` is never slowed, and a shared
  front door is deliberately not throttled rather than wrongly throttled.
- A **category over its budget** is still a hard block, not a slow lane. Only
  the whole-day time budget has the cliff-or-slope choice so far.
- A policer drops packets rather than queueing them, so a throttled connection
  is lossy as well as slow. That is what makes video give up, and it is also
  why the rate should not be set so low that TCP cannot make progress at all.
  The floor of 32 kbit/s is there for that reason.

## Honest limits

- **Shorts vs full YouTube**: same domains, can't split. Both count as video.
- **YouTube Music**: shares YouTube's domains, so it counts as video. Fine if
  the house uses Spotify or Apple Music, which are never metered. Do not rely
  on YouTube for music during a video block.
- **Active vs background**: threshold-based, ~90% right, not perfect (a paused,
  pre-buffered video can look idle).
- **Determined bypass**: a VPN hides destination IPs, so categorisation fails.
  That's a bug-bounty level, and we can block known VPNs to raise the bar.
- **Shared front doors are dropped, not guessed.** A bare `googlevideo.com`
  lookup returns a general Google edge address that also answers for search and
  the Play Store. Metering it made every byte a phone sent to Google look like
  YouTube, which is what made the live chart show the whole house watching
  video all day. `kidnet-catmap` now tags an address only when it answered for
  exactly one category and for no uncategorised name in the window it scanned.
  The cost is real: a dedicated CDN host that appears once beside an
  uncategorised name is dropped too, so a category can be under-counted. Under
  the true figure is a far smaller lie than colouring the whole house with it.
- **The map is only as good as its list.** Bytes come from CDN names, not front
  doors: nobody streams from `netflix.com`, they stream from `nflxvideo.net`.
  A service whose CDN is not in `category_domains` lands in "other". That list
  lives in `config/db/schema-services.sql` and `config/db/schema-categories.sql`
  and is meant to be extended. It is seeded with about 175 category domains and
  30 services over 103 domains, which is a decent starting set for a New Zealand
  household and nothing like exhaustive: regional streaming services in
  particular are missing. Until 2026-08-29 there was no seed at all, and the
  reference box's forty-odd hand-typed rows meant a fresh install metered
  nothing.
- **Under-counting is the deliberate failure direction.** Between naming
  something wrongly and not naming it, this layer always chooses not to name it.
  Traffic Hearth cannot attribute shows as "other" rather than being guessed
  into a category, and a child is never charged a minute for a category the
  meter is not sure about.

## Status: built and deployed (2026-08-29)

1. `kidnet-catmap` reads AdGuard's query log, maps answer IPs of known
   category domains into `category_ips` (the "these IPs = gaming" learning).
2. `config/nftables/kids.nft` has per-category IP sets (gaming_ips, video_ips,
   download_ips) and dynamic per-device byte counters (gaming_dev, video_dev,
   download_dev) in a metering chain that counts without changing any verdict.
   That ruleset is baked into the gateway image, so on an island that has not
   been rebuilt since the download category landed, `kidnet-catmeter` creates
   the two missing sets and the one counting rule itself on the next tick. It
   only ever adds what is genuinely absent, so it cannot stack a duplicate rule.
3. `kidnet-catmeter` (per minute) reconciles the IP sets to `category_ips`
   (flush and refill in one transaction, so a withdrawn address leaves the
   firewall too), reads + resets the per-device counters, counts one active
   minute for any device over a small byte threshold (so idle keepalive does not
   count), attributes it to the child, and when a child reaches their
   `category_budgets` daily_min blocks that category (DNS via kidnet-adguard
   plus the category set). Downloads are counted but never enforced. Music,
   schoolwork and chess are never metered.
4. `kids-metering.timer` runs both each minute. Proven by test/meter-test.sh
   (eight checks: active counts, idle ignored, budget reached, category
   blocked, others untouched, and the grant path below).
5. `kidnet grant <kid> <gaming|video> <min>` tops up ONE category: it raises
   that category's daily budget and clears an over-budget block for it. It
   deliberately cannot clear a block a parent set, only one the meter set, so
   earning time never overrides a parent's decision. `kidnet bonus` remains the
   general-minutes grant.

## Bytes as well as minutes: per-service accounting

Metering answers "how long". A second layer, built the same way, answers "how
much, and of what". `kidnet-servicemap` learns which addresses belong to which
named service (YouTube, Netflix, TikTok, Roblox, Steam and the rest) from the
same DNS answers, and `kidnet-servicemeter` generates its own nftables sets and
a counting chain from the `services` table, then reads real byte counters per
device per service into `service_usage`.

That chain only counts. Its policy is accept and it never drops, so it cannot
change any verdict or affect connectivity. It runs every minute from
`kids-services.timer`, and it is what lets the dashboard's Trends page report
measured bytes rather than a guess derived from lookup counts.

The same honest limits apply, one level sharper: services sharing a CDN blur
together, an address serving several services attributes to whichever resolved
it most recently for that device, and bytes are not minutes. Both numbers are
reported; neither is the whole story. Adding a service is a database row, not a
firewall edit: see `config/db/schema-services.sql` and docs/CLI.md.

## The live wire, and why it never touches these counters

The dashboard's "Right now" page reads the same firewall every second and a
half to draw real-time traffic charts. Two things keep that away from the
metering above.

First, it only ever **reads**. It runs one command per tick,
`nft -j list sets inet kids`, which returns every dynamic set with its counters
in a single call. Listing a set does not reset it, so `gaming_dev`, `video_dev`
and every `svc_*_dev` keep accruing exactly as `kidnet-catmeter` and
`kidnet-servicemeter` expect. The dashboard never flushes, adds to or deletes
any of those sets, and never edits a rule that feeds them. It also copes with
the meters' own once-a-minute flush: when a counter reads lower than it did a
tick ago, the live wire treats that as a reset rather than as negative traffic.

Second, per-device totals get their own separate pair of sets. nftables has no
grand total per device, only per category and per service, so "a lot of
bandwidth is going out, who is responsible?" cannot be answered from the sets
above: a speed test or a game download belongs to no category. The dashboard
therefore maintains `live_up_dev` and `live_down_dev`, fed by a `livemetering`
chain at forward priority 30 that contains nothing but two `update` statements
and accepts everything. Like the service chain it only counts: it cannot change
a verdict, and it sits after the filter chain so blocked traffic is never
counted. The sets carry a ten-minute timeout so they cannot grow without bound,
and the chain is only ever created when it is genuinely absent, so a restart
cannot stack duplicate rules. Set `HEARTH_LIVE_DEVICE_TOTALS=0` on the
dashboard to turn it off; everything else keeps working, and per-device figures
fall back to "traffic Hearth can put a name to".

The household figure on that page comes from somewhere else again: the kids0
byte counters in `/proc/net/dev` inside the gateway container. That is every
byte that crossed the wire, named or not, which is why the household total is
usually larger than the sum of the devices Hearth can attribute.
