# Tor, the darknet, and why we alert instead of pretending

For parents and contributors. What the Tor/darknet layer actually does,
what it honestly cannot do, and why the response to a blocked attempt is a
warm page and a conversation, not a punishment screen.

**Status: built, with one gap.** The DNS layer, the `tor_nodes` and `tor_dev`
nft sets, the daily relay-list refresh and the warm portal page all ship and
are covered by tests. The one piece still missing is the alert pass that turns
a `tor_dev` counter into an alert row, so the IP road counts attempts but does
not yet tell you about them. Detail at the end of this file.

## Why this layer exists

Tor itself is legitimate technology (journalists, activists and plenty of
adults use it for good reasons). On a kids' network the calculus is
different: for a child, reaching for Tor usually means reaching for what
Tor hides, and what it hides includes darknet drug markets and seriously
objectionable material. A kid installing Tor Browser is not automatically
in trouble, but it is always worth a conversation. So the design is:

1. **Block the easy road.** Default Tor and the clearnet on-ramps into the
   darknet are blocked. A curious kid bounces off.
2. **Alert on the attempt.** The attempt itself is the information. The
   parent gets told, quietly, with context.
3. **Make the block an invitation.** The page the kid sees says "come talk
   to me", because the conversation is the actual safety mechanism.

## How the blocking works (two layers)

**DNS layer (AdGuard).** Lookups of torproject.org, bridge and Snowflake
hosts, onion gateways (the tor2web proxies that serve `.onion` sites to a
normal browser) and darknet directories like dark.fail are answered with
the portal IP, so the kid lands on the warm page. Every one of those
lookups also matches the `flag_domains` table and raises an alert. Detail:
config/adguard/tor-and-serious.md.

**IP layer (nftables).** `bin/kidnet-tor-sync` fetches the full public Tor
relay list (about 7,000 to 8,000 addresses, from the Tor Project's own
Onionoo directory API, with dan.me.uk as fallback) and renders it into the
`tor_nodes` set. The firewall then refuses connections from the island to
any public relay. This is the layer that stops a Tor client that never
touches DNS at all, because it ships with relay addresses baked in. The
full relay list matters: a Tor client connects to an entry (guard) relay,
so the widely shared "exit node" lists, which exist for servers refusing
Tor visitors, would block nothing in our direction.

## The honest limits

Say this part out loud, because a false sense of a perfect block is more
dangerous than no block:

- **Bridges beat IP lists by design.** Tor bridges are unlisted relays,
  handed out a few at a time, precisely so lists like ours miss them.
- **Pluggable transports beat traffic recognition by design.** obfs4 makes
  Tor look like random noise, Snowflake looks like a WebRTC video call
  through volunteers' browsers, meek rides big CDNs, and WebTunnel looks
  like ordinary HTTPS to a real website. These tools hold up against
  national censors; a home gateway will not beat them.
- **Other roads exist.** Cellular data, a friend's wifi, a USB-booted OS.
  PLAN.md is honest about all of these for the network generally.

So what is the point? The block stops the casual, low-effort path, which
is the path nearly every kid takes. And the moment a kid puts in the
effort to go around it (fetching bridges, configuring Snowflake), they
cross tripwires that tell us MORE, not less: `bridges.torproject.org` is
an urgent alert, and the `tor_dev` counters record attempts against known
relays. A kid working that hard to hide has told you something a filter
never could. That is when a parent walks over, and that conversation is
the real defence. Detection plus relationship beats a wall every time,
because the wall is beatable and the relationship is not supposed to be.

This is also why bypass attempts are bug-bounty material (BUG-BOUNTY.md):
a kid who finds a hole and TELLS US earns time and pride. The incentive
points at honesty, not at getting better at hiding.

## What we deliberately do not claim to handle

The worst category of darknet material, child sexual abuse material, is
not a thing this project filters, detects, or discusses on a portal page.
There is no public blocklist for it and there should not be; blocking
lives upstream (our Quad9 resolver, safe-browsing services, and in NZ the
DIA's ISP-level filter), and anything actually encountered is a matter
for the police, the DIA (dia.govt.nz) and Netsafe. A home firewall has no
role there beyond choosing good upstreams, and pretending otherwise would
be false comfort.

## The warm portal page

When a Tor or darknet attempt hits the portal, the kid sees this. It is
built: `dashboard/portal.mjs` renders it for the flag categories `tor`,
`darknet` and `drugs`. Tone rules: no shame, no alarm, name the block
honestly, make the next step tiny, keep the safety lines visible, and keep
the bug-bounty door open.

> ### This one is blocked, and it is a "come find me" one
>
> You tried to reach Tor or a hidden ("darknet") site. That part of the
> internet is blocked on our network, not because curiosity is bad, but
> because some of what lives there is genuinely harmful, and it hides
> where you are going, even from you.
>
> **You are not in trouble.** Wondering what is out there is completely
> normal. Come find me and tell me what you were looking for, or what you
> heard about, and we will figure it out together. If it feels awkward to
> say, you can literally start with "this is awkward". That works.
>
> If something you saw online is worrying you and you would rather talk
> to someone who is not your dad first, the help lines below are always
> open from any device, even when the internet is off.
>
> And if you actually found a way AROUND this block: nice. That is a bug
> bounty. Show me how you did it and you earn time, you do not lose it.
>
> [Help lines: 1737, Youthline, Kidsline, The Lowdown]

How the portal knows: it reads the `alerts` table for a recent row whose
category is `tor`, `darknet` or `drugs`, within a twenty minute window
(`PORTAL_FLAG_WINDOW_MIN`). Both roads into the page are meant to arrive
there, which is why the portal only has to read one table. Anything else
falls back to the generic blocked page. Self-harm is an explicit allow-list
exclusion rather than a filter, so a flag category added later cannot quietly
start putting a struggling kid in front of a wall.

## The nftables pieces, as they ship

This is what is in `config/nftables/kids.nft` today. Nothing here weakens
isolation, DNS forcing or the safety net.

```nft
# --- declarations, alongside the existing sets -------------------------

# Public Tor relay addresses. Populated by kidnet-tor-sync (deploy + a
# daily timer) via the generated /var/lib/hearth/tor-nodes.nft snippet;
# NEVER edited by hand. flags interval so ranges can be added later.
set tor_nodes { type ipv4_addr; flags interval; }

# Per-device Tor attempt counters, same pattern as gaming_dev: any island
# source that touches a known relay gets an element with a counter. The
# alert pass reads these to attribute attempts to a child and raise the
# "worth a quiet word" alert even when DNS saw nothing.
set tor_dev { type ipv4_addr; flags dynamic; counter; }

# --- forward chain, placed AFTER these existing rules:
#       iifname $KIDS_IF ip daddr @kids_allow accept        (safety net wins:
#         a help line sharing a CDN address with a relay stays reachable)
#       iifname $KIDS_IF ip saddr != @kids_known drop       (strangers stay dropped)
#     and BEFORE the kids_block rules, so an attempt from an already-blocked
#     device is still counted and still fails fast. --------------------

# Count the attempt first (never changes a verdict), then refuse it.
iifname $KIDS_IF ip daddr @tor_nodes update @tor_dev { ip saddr }
# Reject, not drop: Tor Browser fails fast instead of hanging, and the kid
# looks at a clear failure rather than a broken-wifi mystery. The warm
# page arrives via the DNS layer (tor on-ramps portal-redirect) and via
# the portal surfacing the tor_dev attempt on its next load; Tor's own
# TLS to a relay cannot be redirected to an HTTP portal.
iifname $KIDS_IF ip daddr @tor_nodes meta l4proto tcp reject with tcp reset
iifname $KIDS_IF ip daddr @tor_nodes reject
```

## What is wired, and the one thing that is not

Done:

1. **The relay list.** `kidnet-tor-sync sync` runs at deploy and then daily
   from `kids-tor-sync.timer`, with up to two hours of jitter so we are not
   hammering the Tor Project's directory API on the stroke of midnight.
2. **The apply step.** `kids-tor-sync.service` pipes the generated snippet
   into the gateway container, so `@tor_nodes` is flushed and refilled in a
   single nft transaction and is never momentarily empty. If the running
   image predates the set, the apply is skipped rather than failing the unit.
3. **The DNS layer.** The `flag_domains` seed in `config/db/schema-flags.sql`
   carries the on-ramps, bridges, onion gateways and market directories, and
   `kidnet-adguard` renders the `tor`, `darknet` and `drugs` patterns as a
   portal redirect for every child.
4. **The tests.** `test/firewall-test.sh` proves an online kid cannot reach a
   relay, that the attempt is counted in `@tor_dev`, that the safety net still
   wins over the Tor block, and that an already-blocked device's attempt is
   still counted.

**Not done: the alert pass.** Nothing reads `@tor_dev` and turns a nonzero
counter into an alert row. So the IP road blocks and counts, but only the DNS
road actually tells a parent. A kid whose Tor client dials a baked-in relay
address without ever making a lookup is refused and counted, silently. The
natural home is `kidnet-catmeter`'s minute loop, using the same read-and-reset
pattern as the byte counters: nonzero counter becomes an `alerts` row with
category `tor` and severity `urgent`, noting how many relay addresses were
attempted.

Until that lands, this document, the portal comment that says the counters are
"attributed to a child by the metering pass", and anything that implies the IP
road alerts, are describing an intention rather than behaviour. Said plainly
here because a half-built tripwire you believe in is worse than no tripwire.
