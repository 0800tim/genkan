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
| social (Insta/Snap) | no | blockable, but not counted: it overlaps video |
| audio (Spotify, Apple Music) | NO | "singing in the shower" is fine |
| schoolwork (Drive/Docs/Khan) | NO | encourage it |
| chess, messaging Dad, general web | NO | not in a metered set |

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
