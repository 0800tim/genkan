# How per-category time metering works

Goal: count ACTIVE minutes on time-wasters (gaming, YouTube/video, scrolling)
and DON'T count music, chess, schoolwork or talking to Dad. Then cap each
category separately (e.g. 2h gaming/day, 1h YouTube/day; music unlimited).

## The one trick that makes it possible

We can't read inside encrypted traffic, but **clawdia is the DNS server**, so
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
| social (Insta/Snap) | optional | overlaps video |
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
- **YouTube Music**: shares YouTube's domains, so it'd count as video. You use
  Spotify for music, so fine, just don't rely on YouTube for music during a
  video block.
- **Active vs background**: threshold-based, ~90% right, not perfect (a paused,
  pre-buffered video can look idle).
- **Determined bypass**: a VPN hides destination IPs, so categorisation fails.
  That's a bug-bounty level, and we can block known VPNs to raise the bar.

## Status: BUILT (2026-08-29), enforced at deploy

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
   (active counts, idle ignored, budget reached, category blocked, others
   untouched).

Bonus/earn topping up a specific category is the next small addition
(kidnet bonus currently adds general minutes; a per-category grant clears the
over-budget block for that category only).
