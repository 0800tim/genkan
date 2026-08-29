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

## Turning a category OFF (enforcement, separate from metering)

"Turn gaming off" = two moves on the gaming set:
1. DNS: answer gaming domains with the portal IP (so they get the "time's up"
   page, not a dead connection).
2. Firewall: drop flows to the gaming IP set.
Precise: kills Roblox/Fortnite/Steam while chess, music and homework stay up.

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
  and is meant to be extended.

## Status: built and deployed (2026-08-29)

1. `kidnet-catmap` reads AdGuard's query log, maps answer IPs of known
   category domains into `category_ips` (the "these IPs = gaming" learning).
2. `config/nftables/kids.nft` has per-category IP sets (gaming_ips, video_ips)
   and dynamic per-device byte counters (gaming_dev, video_dev) in a metering
   chain that counts without changing any verdict.
3. `kidnet-catmeter` (per minute) refreshes the IP sets from category_ips,
   reads + resets the per-device counters, counts one active minute for any
   device over a small byte threshold (so idle keepalive does not count),
   attributes it to the child, and when a child reaches their
   `category_budgets` daily_min blocks that category (DNS via kidnet-adguard
   plus the category set). Music, schoolwork and chess are never metered.
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
