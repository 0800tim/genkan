# How Hearth got here: the decision log

The reasoning behind the design, captured so the "why" isn't lost. Written
2026-08-27/28 from the conversation that built the project.

## The original ask

Tim: kids (11, 14, 16) won't get off their devices. Wants to control their
internet over WiFi, turn devices on/off, ideally by TALKING to the assistant
from his phone ("turn off Ben's internet", "kill kids wifi"). Also wants to
kill his son's Android MOBILE DATA.

## First reality checks

1. **The Hearth box is a LAN host, not the router.** The gateway is an ASUS at
   192.168.1.1 (SSH off). A host can't cleanly cut another device's traffic
   without controlling the router or ugly ARP tricks. So we needed the Hearth box to
   BE the gateway for the kids, on its own segment.
2. **Mobile data can't be touched by ANY router.** Cellular goes phone ->
   tower -> internet, never through the house. The only lever is Google
   Family Link (pause device / downtime, works over cellular). Tim already
   uses Family Link and is on Android for exactly this reason. Decision:
   Hearth owns HOME network time; Family Link owns the device + cellular;
   they run in parallel (no shared API, grant bonus in each separately).

## Hardware path (what we rejected and why)

- **Flash the Huawei HG659 with OpenWrt** -> impossible. Broadcom BCM63168,
  closed drivers, unsupported. Would brick it. Honest no.
- **OPNsense/pfSense** -> these are x86 whole-network firewalls, not router
  firmware. Overkill and the wrong shape (would route the whole house through
  a new box). Rejected for this job.
- **CHOSEN: the Hearth box as the kids' gateway** via a spare USB-ethernet adapter.
  Zero new OS, always-on, fully agent-controlled, ~$0. This is essentially
  "OPNsense-style control" but on the Linux box we already own.

## The topology we settled on

    ASUS (192.168.1.1) -> the Hearth box enp5s0 (uplink, unchanged)
                           the Hearth box kids0 (USB ASIX AX88179) = 192.168.60.1 gateway
                              -> spare switch
                                   -> son's wired PC
                                   -> TP-Link Deco X20 (AP MODE) -> kids' + guest WiFi

- USB NIC detected: ASIX AX88179 = kids0 (mac in config.env, gitignored).
- Deco X20 is APP-ONLY (no web UI / SSH / API). We don't need to control it:
  Tim flips it to Access Point mode ONCE via the app, then it's a dumb bridge
  and the Hearth box owns everything. Must NOT stay in router mode (it would NAT and
  hide devices behind one IP, defeating per-device control).
- Confirmed cabling (Tim, for his house layout): kids0 -> Deco port 1;
  Deco port 2 -> switch -> wired devices.
- DHCP: the Hearth box is the single DHCP+DNS server. Deco in AP mode runs neither.
- Guests join the SAME isolated island (internet yes; main network no).

## Security decisions

- **Segment isolation**: the kids/guest island cannot reach the main
  192.168.1.0/24 LAN where the Hearth box and all client work live. Guests get
  internet, nothing else. (nftables forward drop to RFC1918 internals.)
- **DNS forcing**: redirect all :53 to the Hearth box, block DoT (853), filter DoH,
  so a kid can't set 8.8.8.8 or "Secure DNS" to bypass filtering. (Tim asked
  what DoH/DoT were; this is why they matter.)

## Age-tiered policy (kids are 11 / 14 / 16)

One filter for all three would be wrong.
- **11 (young)**: tight. Block adult/gambling/drugs/self-harm/dating/weapons/
  VPN. SafeSearch + YouTube-restricted forced. 90 min school / 180 weekend.
- **14 (standard)**: block the harmful, keep social but logged. 120/240.
- **16 (teen)**: LIGHT TOUCH on purpose. Over-blocking a 16yo pushes them to
  mobile data or a mate's hotspot and wrecks trust. Block only the seriously
  harmful; no blanket network time cap; focus on alerts + transparency.
- **guest**: adult/malware/VPN filtering only, isolated, no per-person logging.

## What we meter, and the clever bit

Tim's real problems: YouTube/Shorts (doom-scrolling), Roblox, gaming. But he
does NOT want to time music (son sings to Spotify while studying), chess, or
talking to him. So metering is PER CATEGORY, not "internet on":
- Metered: gaming (Roblox/Fortnite/Steam/consoles) + video (YouTube/Shorts/
  TikTok/Netflix). Each with its own daily budget.
- Never metered: audio (Spotify), schoolwork, chess, messaging Dad.
- **The trick**: the Hearth box is the DNS server, so it knows which IPs belong to
  which app, and can tag encrypted traffic by category WITHOUT decrypting it
  (device resolves googlevideo.com -> those IPs = video). Per-minute byte
  counters on category IP sets tell us "actively using" vs idle.
- Honest limits (documented, not hidden): can't split Shorts from YouTube;
  YouTube Music rides on YouTube's domains (fine, Tim uses Spotify); active-
  vs-background is ~90% right; a VPN defeats categorisation (bug-bounty level).

## Modes + incentives

- **study mode**: internet on, gaming + video off, schoolwork + music on.
- **gaming off / media off**: surgical (kill Roblox while chess/Docs/Spotify
  stay up). media = video + social; audio always survives.
- **dinner / family pause**: one word pauses all kids, then resume.
- **Time budgets + bonus/earn**: daily minutes per metered category; Tim (or
  an earned chore/quiz) grants bonus; unrot-style effort->reward. Dashboard
  has +15/+30/dishes buttons.
- **Captive portal**: when blocked/out of time, the kid's screen shows a
  friendly "Time's up, earn +30 with the dishes, then see Dad" page instead
  of pages silently failing. Uses OS captive-portal detection so it pops the
  sign-in sheet on Android/iOS/Windows(wired PC)/Mac. HTTPS can't be painted
  inside an open tab (that's every cafe portal's limit too). Help lines shown
  and always reachable.

## Ethos + honesty (threaded throughout)

- Self-hosted, MIT, no telemetry, data never leaves the house. Sibling to
  Tim's `unrot` (earn screen time by learning).
- **Transparency over covert surveillance**, especially for the older two.
  Reading a teen's everything destroys trust and pushes them off-network.
  Monitor at "flag genuinely harmful", not "read their DMs".
- **Safety net**: NZ youth help lines (1737, Youthline, Kidsline) are never
  blocked, even at bedtime or during a cut. Self-harm searches -> urgent alert
  regardless of age.
- **Honest limits stated plainly**: in-app bullying (Snapchat/Insta/Discord
  DMs) is end-to-end encrypted and invisible to the network -> needs a
  consenting app tool like Bark; mobile data -> Family Link; HTTPS -> domains
  not content.

## The bug bounty (turn "they'll try to beat it" into learning)

House rule: if you find a bypass, don't quietly use it, SHOW Dad how, earn a
reward, we fix it together (responsible disclosure). Five levels, each a real
skill: DNS (lvl 1), DoH/DoT (lvl 2), static IP (3), MAC spoof (4), VPN/hotspot
(boss). Every hole found hardens the open-source project.

## Open-sourcing

- Tim wants other parents to use + collaborate (posted on Facebook, interest
  already). One-page pitch built as an artifact, working title "HEARTH" (the
  warm centre of a home; a cousin of "heart"; the opposite of everyone on
  separate screens). Naming is deliberately left open for the community.
- Repo GENERICISED: real MAC + tailnet IP removed from tracked files (they
  live only in gitignored config.env); deploy.sh generates the udev rule from
  config.env. secrets (DB password) gitignored.
- At the time: not pushed to GitHub yet, Tim holding off publicising. gh is
  authed as 0800tim. A rendered public pitch would need GitHub Pages (a raw
  .html GitHub link shows source, not the page). The repo has since been
  published at github.com/0800tim/hearth.

## Status at handover (2026-08-28, superseded)

Software built + committed, NOT deployed to live networking. Dashboard
(:8899) + captive portal (:8890) run on the tailnet. DB seeded. Waiting on
the physical build (switch + cabling + Deco to AP mode), then deploy.sh +
AdGuard Home + per-category enforcement wiring (~30-40 min). A dedicated
tmux session `kids-network` runs Claude in bypass-permissions mode in this repo.

## Hardening pass, 2026-08-29 (before the island was ever cabled)

Reviewing the firewall against its own stated guarantees turned up four things
that were written down as true but were not.

1. **The ruleset did not parse.** `set kids_block { type ipv4_addr }` needs a
   trailing semicolon, so `nft -f` rejected the whole file. Nothing had ever
   loaded it, which is why the rest went unnoticed. deploy.sh now runs
   `nft -c` first and refuses to install a file that does not parse: that
   matters because /etc/nftables.conf includes the whole drop-in directory,
   so a bad file there can stop nftables at boot and take NAT down with it.

2. **The safety net existed only in the database.** always_allow was seeded
   with 1737, Youthline and the rest, and every document promised they stayed
   reachable during a cut, but no firewall rule read the table. A blocked kid
   could not reach a help line. There is now an `@kids_allow` nft set, fed
   hourly by `kidnet allow-sync` (which resolves the domains, since the
   firewall matches addresses and these sites are CDN-hosted), placed above
   the block rules in the forward chain.

3. **A blocked device fell off the network instead of seeing the portal.**
   The input chain dropped blocked devices before the DHCP and DNS accepts, so
   "off" meant no address and no name resolution: pages fail silently, which
   is the exact thing the captive portal was built to prevent. DHCP, DNS and
   the portal are now unconditional, and the accepts are pinned to the gateway
   address (without that, `tcp dport 80 accept` matched every address the Hearth box
   holds, including its main-LAN and tailnet ones).

4. **always_allow was doing two jobs.** It had grown to hold both the help
   lines and Spotify, all at scope 'global'. Loading all of it into the
   firewall allowlist would have meant the music kept playing through dinner.
   The `scope` column now splits them: 'safety' survives everything, including
   a full cut; 'category' (Spotify, Apple Music) survives study mode and
   'media off' only. New rows default to 'category', so a domain added without
   thought can never silently punch through a cut.

One rule was removed rather than fixed: `ip daddr @kids_block drop`, meant as
"and the return path". Return traffic reaches the forward chain after conntrack
has reversed the NAT, so its destination is the kid's own address, and the rule
silently killed the replies for the allowlist flows above it, taking the safety
net with it. Unsolicited inbound cannot reach the island through NAT anyway.

All of this is now held in place by `test/firewall-test.sh`, which builds a
three-namespace lab (kid, the Hearth box, internet), loads the ruleset that ships, and
asserts the guarantees with real packets. Twenty checks at the time, no
hardware needed; the suite has since grown to 31 as the Tor layer and the
static-IP defence landed.
Two of them are bug-bounty levels 1 and 2: hardcoding 8.8.8.8 still lands on
our resolver, and the known DoH endpoints are refused.

Worth knowing: writing that test caught a false pass. The isolation checks were
green only because the lab gateway had no route to the main-LAN subnet, so the
packets died on an unreachable-network error and never reached the firewall at
all. A test that passes for the wrong reason is worse than no test.

## Containerisation night, 2026-08-29

Tim: "make sure this is containerised... immune to damaging or interfering
with our local setup". The honest engineering answer: a container is only
immune if the isolation is by NAMESPACE, not by trust. A privileged
container or one with host networking could still wreck the box. So the
design is: the gateway container gets its own network namespace; the host
warden (the single remaining host-side piece) physically moves the USB NIC
into it; rules load in there with NET_ADMIN+NET_RAW and cap_drop ALL. The
interfaces that matter to the house do not exist in the container's world,
which is a stronger guarantee than any rule review.

Decisions that fell out of building it:

- **Docker over a plain systemd namespace** (Tim chose, trade-off stated):
  a Docker daemon restart takes the island down briefly; restart=always
  plus the warden re-handing the NIC covers recovery; other parents get
  the runtime they already know. The no-docker variant stays possible
  (kidnet NFT_DIRECT=1).
- **The DB is desired state; the firewall is a projection.** The gateway
  reconciles kids_block from Postgres every 15s in one atomic nft
  transaction. This is what lets the portal grant earned time by writing
  a row, survives restarts and replugs, and means kidnet's direct nft
  calls are just a fast path.
- **Segment guard.** Born from a real event: the Deco, freshly plugged in,
  bridged the main house LAN onto the kids' port (it was still meshed to
  the house WiFi). Starting DHCP there would have fought the house router.
  The gateway now refuses to serve until the wire is verifiably quiet, and
  fails closed if it cannot verify. First run of the guard caught its own
  silent failure: Debian tcpdump drops to a uid needing CAP_SETUID we had
  removed, died instantly, and 2>/dev/null made that look like "quiet".
  The guard now requires positive proof it listened. Twice now this
  project's lesson is: a check that passes for the wrong reason is worse
  than no check.
- **Earning back is scoped.** A quiz pass lifts only set_by='out-of-time'
  blocks. A deliberate parent block (dinner, discipline) is never undone
  by earning; that would put the kid in charge of the parent's decision.
- **Quizzes auto-credit, chores need Dad** (Tim chose): instant feedback
  for learning, human judgement for claimed housework. Both land in the
  same time_events audit trail.
- **Deco field notes**: X20 is app-only, no web UI, no API, no rooting
  path. Factory reset + standalone network + Access Point mode is the
  entire setup. "Nero" is a fine SSID.

## The bigger picture (Tim, same night)

Omarchy thin clients as the reference distribution: any PC with two NICs,
install Omarchy (agent-first OS, Docker preinstalled), clone this repo,
tell your agent to follow the runbooks. Learn-to-earn grows into a full
curriculum system (NZ first, runbooks so any country's parents can have
their agent generate banks), per-kid AI tutors that adapt and encourage,
and the repo stays 100% kids' wellbeing and education: no commercial
content in it, ever. Naming shortlist researched (research/naming.md);
Porchlight currently leads; decision deferred to Tim/community.

## Repo shape: monorepo for now (2026-08-29)

Tim asked: one big monorepo, or several libraries/repos? Decision: ONE
repo until it hurts. Reasons: the parent's setup story is "clone one
thing, tell your agent to read CLAUDE.md"; agents navigate a monorepo
better than a constellation; the pieces (gateway, portal, quizzes, docs,
future voice container) version together while the interfaces are still
moving. Revisit when there are real external consumers of a piece: the
quiz-bank format and the voice container are the likeliest first
extractions (npm package / separate image). The commercial folder is
already a separate private repo and stays one.

## Security review + hardening, and Omarchy direction (2026-08-29, late)

An independent adversarial review (research/security-review-2026-08-29.md)
confirmed the containment is genuine: nothing in the island can reach the
house LAN, tailnet or Postgres, the containers are unprivileged with
cap_drop ALL, and the SQL is parameterised. It found one real HIGH: the
island forward chain defaulted to accept, so a static IP outside a device's
reservation escaped every control. Closed with a kids_known default-deny set
(reservations + active leases, reconciled from the DB), proven by tests. Also
closed: the portal ?kid= identity switch, AdGuard holding NET_ADMIN in the
shared namespace, IPv6 falling through the v4-only rules, and the earn/argv
low findings. A committed dev credential was replaced with a placeholder and
deploy now generates a real one; docs/GO-PUBLIC-CHECKLIST.md tracks the
history scrub still needed before any public push.

Direction set by Tim tonight: Omarchy-first. Studied the Omarchy repo and
built install/omarchy-setup.sh + the runbook. The through-line of every idea
dump (logged verbatim in memory) is LOCAL and THEIRS: family protection that
lives inside their walls, not the cloud, no surveillance, bring your own AI.
That is the emotional spine and every piece of copy must protect it. Bigger
vision now spans voice ("Hey Claudia" with speaker ID and a phone-notify
audit trail, impersonation as a bug-bounty Easter egg), home automation (Home
Assistant), a full learn-to-earn curriculum, and per-kid AI tutors. DHH
endorsement is a stated goal; trademark use stays strictly nominative. Monorepo
for now (revisit when a piece has real external consumers). Commercial thinking
stays entirely in the separate private repo.

## Public, and the documentation audit (2026-08-29)

The repo is now public at github.com/0800tim/hearth. Everything above about
"not pushed yet" is history; docs/GO-PUBLIC-CHECKLIST.md carries what that
means for the items on it, including the history scrub.

A full documentation pass ran the same day, checking every document against
what the code actually does. Four things worth recording, because they are the
same failure mode each time: **a document that describes an intention in the
present tense is indistinguishable from a document that describes behaviour,
and only one of them is true.**

1. **Shipped features were undocumented.** Per-service byte accounting
   (kidnet-servicemap, kidnet-servicemeter, schema-services.sql) and device
   classification (kidnet-classify, schema-devices.sql) both existed, were
   tested, and appeared in no prose anywhere. The second one is a genuine
   selling point: your smart lock is never cut when you pause the kids,
   because the group commands only touch devices classed `personal`.
2. **The tool count drifted.** Documents said nine shell scripts; there are
   fourteen. deploy.sh installs thirteen of them.
3. **The Tor layer read as a design.** docs/tor-and-safety.md still carried a
   "wiring checklist for the main agent" for work that had shipped, while the
   one piece that had NOT shipped, the alert pass that turns a `tor_dev`
   counter into an alert row, was buried in the same list. Corrected: the IP
   road blocks and counts, but only the DNS road tells a parent. Named
   plainly, because a half-built tripwire you believe in is worse than none.
4. **The database story had a hole.** docs/DATABASE.md listed six of the ten
   schema files, in an order that would have silently produced a
   `device_roster` view with no device class, and claimed compose provisions
   Postgres. It does not: compose joins an external `postgres` network and
   expects a container to be there. There is also no seed for the `tasks`
   table, so a fresh install has no earnable chores at all.

Two new documents came out of it: docs/CLI.md (every command, its arguments and
what it really does, written from the scripts) and docs/OPERATIONS.md (health
checks, what each timer does, reading the logs, what the segment guard refusing
to start means, a device with no internet, rotating the AdGuard password,
backup and restore).

Open, and deliberately not fixed in a documentation pass:

- **python3 is missing from the gateway image.** The Dockerfile installs
  nftables, iproute2, ping, tcpdump, psql and ca-certificates. The entrypoint's
  `reconcile_set` uses python3 to read the current nft set, so the comparison
  always sees an empty set and rewrites both sets every fifteen seconds. The
  island works because the rewrite is idempotent, but the "has anything
  changed" check does nothing, the logs are noise, and `adguard_lease_ips`
  (the optimisation that gets a freshly joined device online without waiting a
  minute) silently returns nothing.
- **No systemd unit for the dashboard ships in the repo.** It exists only on the
  reference box. OPERATIONS.md now carries a minimal one to copy.
- **No seed for `tasks`.** DATABASE.md carries the INSERT to run.
- **`schedules` is a table nothing reads.** Bedtimes are not automatic yet.

## Two live-view bugs, and what they exposed (2026-08-29)

Tim, looking at the live page: *"the chart at the top seems to be just showing
video for everything... If I was downloading a game update, that should just be
other"*, and *"the 'who's using it right now' keeps flashing in and out"*.

**The chart.** Three separate faults, stacked.

1. **The domain map was never in the repo.** `category_domains` is the whole
   basis of per-category metering, and the forty-odd rows on the reference box
   had been typed in by hand and never committed. A fresh install had an empty
   map, so nothing could ever be categorised. It is now seeded in
   `config/db/schema-categories.sql`, with the CDN names that actually move the
   bytes rather than only the front doors: nobody streams from netflix.com,
   they stream from nflxvideo.net.
2. **Shared front doors were metered.** `kidnet-catmap` tagged any address that
   answered for a category domain. A bare `googlevideo.com` lookup returns a
   general Google edge address that also serves search, Gmail and the Play
   Store, so every byte a phone sent to Google was counted as video. That is
   precisely what Tim was seeing. The mapper now tags an address only if it
   answered for exactly one category and for no uncategorised name in the
   window it scanned, and withdraws one that turns out to be shared. It also
   ignores `0.0.0.0`, which is what a blocked query resolves to: without that,
   one blocked domain could tag the null address and swallow the island.
   The cost is honest and stated in METERING.md: a dedicated CDN host that
   appears once beside an uncategorised name is dropped too, so a category can
   read low. Under the true figure is a far smaller lie than colouring the
   whole house with it.
3. **The address sets were add-only.** `kidnet-catmeter` added to `gaming_ips`
   and `video_ips` and never removed, so a mis-tagged address kept colouring
   traffic until the container was restarted. It now reconciles: flush and
   refill in one transaction, the same pattern the gateway's `reconcile_set`
   already uses.

**Downloads are not screen time.** A 60 GB console update is the biggest thing
on the wire all evening and it is not playing. `download` is now a category of
its own with its own nftables set, its own band on the chart and its own
colour, and it is deliberately excluded from budget enforcement. Two rules
separate it from play: the content-delivery names are longer domain suffixes
than the gaming names they sit under (so `cs.steampowered.com` beats
`steampowered.com`), and more than 50 MB in one minute to a *gaming* address is
booked as a download regardless. The rate rule is not applied to video, where
4K streaming is legitimately fast. The same threshold is used by the live chart
and by the meter, so what a parent sees and what gets booked agree.

`config/nftables/kids.nft` is baked into the gateway image, so the new sets only
reach a running island on a rebuild. `kidnet-catmeter` therefore creates them
itself when they are absent, once, the same way `kidnet-servicemeter` creates
its own chain. An island upgrades on the next minute tick instead of needing
the container restarted.

**The flicker.** The "who is using it right now" list was rebuilt from scratch
whenever its membership *or its ordering* changed, and a device only appeared
at all if it had moved a byte in that 1.5-second tick. A video buffering or a
game between rounds dropped a device out of the list and put it back a second
later, and two devices swapping places tore the whole card down. Now anything
that has moved a byte in the last five minutes stays listed, fading as it goes
quiet and showing its live rate (which may be zero) rather than a stale one,
and rank changes move the existing rows instead of rebuilding them. Five
minutes matches the roster's own "online" window, so a device leaves the list
at about the moment it stops counting as online.

## The speed test belongs inside the dashboard (2026-08-29)

The Speed link pointed at the gateway's own address on the family network, port
8877. The test has to run there, because the gateway is the only machine that
can see the family's wifi from the inside. But a parent reading the dashboard is
on the other side of the gateway, on the admin network, so the link was dead for
exactly the person it was for.

Two ways to fix that: publish the speed test on the admin side as well, or proxy
it through the dashboard. We proxied it, at `/speed`. The dashboard already sits
on both sides of the gateway and is already the one private front door a parent
uses, so proxying adds no new listener and nothing new to secure. Publishing a second
port would mean a second address to remember, on a page whose whole job is to be
the one place a parent looks. The measurement endpoints stream through
untouched, because they move tens of megabytes and buffering them in order to
rewrite them would defeat both the measurement and the memory budget. The
gateway's address is asked of docker rather than hardcoded, since it changes
whenever the container is recreated, and it is looked up again on any connection
failure, which is exactly the moment it has moved.

Then two bugs, which together produced a confidently wrong number. That is worse
than an obvious zero, because nobody goes looking for it.

1. **The prefix was bypassed.** The page's own script asked for `/ping`,
   `/download` and `/upload` as absolute paths. Right when the test is served at
   its own root, wrong the moment it is proxied under `/speed`: every one of
   those requests landed on the dashboard instead. The proxy now points them at
   the prefix, naming the five endpoints explicitly rather than rewriting by
   pattern, because a pattern eventually rewrites something that was not a
   request.
2. **A failed request counted as throughput.** The client booked 8 MB whenever
   an upload fetch *resolved*, success or not. A 404 answered in nine
   milliseconds was therefore recorded as 8 MB transferred, which scores at
   roughly 7 Gbps per stream. That is how a wifi link reported 2.2 Gbps beside a
   download of exactly zero: nothing was moving in either direction, and only
   one of the two numbers looked obviously wrong. Uploads now count what the
   server confirms it received, which is what the comment above them always
   claimed. A non-2xx download or ping is an error rather than a slow link, and
   a phase where every stream failed raises instead of returning a figure
   computed from an elapsed time and no bytes.

The bar also names the leg it measured. Through the dashboard that is this
device to the box over whatever network you are on, which is not the family
wifi, and the page should not let anybody assume otherwise.

## A System page, on its own slow clock (2026-08-29)

Hearth runs on a box, and the box is the single point of failure for the whole
family's internet. There was nowhere to see whether it was full, hot or
thrashing. `/system` shows CPU, memory, disk, load, uptime, the Hearth
containers and temperature as tiles, then processor, memory and network over
time, with download and upload as separate lines.

Everything is read straight from `/proc`, `/sys` and `statfs`. Nothing shells
out to `top`, `df` or `free` on a timer, because a family gateway can be a
Raspberry Pi and a page that costs a process spawn every few seconds makes the
thing it is measuring slower. One sample is about six small file reads.

**Its own SSE stream, not the live wire.** The live wire samples the family
network every 1.5 seconds through a `docker exec`, and it deliberately only runs
while somebody has Right Now open, because each tick costs a container round
trip. Box health wants the opposite: a slow sample, every ten seconds, that
never stops, held in a three-hour ring buffer in memory. Then the charts have
history the moment the page opens rather than starting from a blank plot.
Bolting it onto the live wire would have meant either making the household
stream carry numbers no other page uses, or tying the box's history to whether
anyone happened to be watching traffic. So: its own sampler, its own buffer, its
own `/api/system/stream`. Nothing is written to the database.

The page answers before Postgres is consulted, so it still renders when the
database is the thing that is broken, which is exactly when a parent goes
looking at it.

Two deliberate absences. Every metric degrades to "n/a" with a reason rather
than to zero, because a health page that invents a zero is worse than one that
admits it cannot see. And the private address the dashboard is reached over is
not listed among the network cards, because this is the page that gets
screenshotted.

## Two public demos, running the real code (2026-08-29)

A stranger arriving at the repo could read about Hearth but not see it. Both
halves are now live: `hearth-demo.appspurt.dev` is the parent's dashboard and
`hearth-portal.appspurt.dev` is the child's captive portal with playable
quizzes.

**The real code, read only, not a copy.** `demo/compose.yaml` bind-mounts
`../dashboard` read only and runs `node server.mjs` and `node portal.mjs`, the
same files the household runs. A demo built as a separate copy is a demo that
drifts, and a drifted demo is a lie with a URL. Mounting the real thing means
improving the dashboard improves the demo on the next restart, and it means the
demo exercises the same code paths a household does, including the control API
and its token cookie. The cost is that the demo has to be made inert by
construction rather than by being a different program, which is a higher bar and
worth meeting explicitly:

- Its own Postgres, its own volume, its own docker network. No route to the
  shared `postgres` container and no credentials for it.
- No docker socket mounted. `docker exec` is the only way anything in a
  container could reach `nft` or `hearth-gw`, so that path does not exist
  whatever the code does.
- `HEARTH_DEMO=1` replaces `runKidnet` and `runTool` in `server.mjs` with
  functions that return "This is the demo, so nothing was actually changed", so
  no path reaches `execFile`, and switches the live sampler to a synthetic one.
- `bin/` is not mounted, so there would be no `kidnet` to run.
- No `NET_ADMIN`, no host networking, no privileged flag.

With the flag unset, which is every household install, all of that is a strict
no-op: the guards are ternaries that evaluate to exactly the code that was there
before.

**The earn guard is relaxed only under the flag.** The portal's `?kid=` override
lets a parent see what a child sees, and at home it is deliberately view only: a
POST needs the request to come from that child's own device, because earning
from somebody else's device would let one child farm another's minutes. The
public demo has no real devices at all, so under that rule the quizzes could be
read and never played, and a portal you cannot play is not a demo of anything.
`HEARTH_DEMO` lifts the device match, and only that. The household's own portal
is untouched, and the demo's database is invented and reseeded nightly, so there
is nothing there to farm.

**It says it is a demo.** A stranger landing on the portal saw a child's name
and a real-looking clock with nothing to mark it as invented, and a screenshot
of that would have travelled as the real thing. Every portal page now carries a
banner. Nothing renders at home.

One demo child is deliberately out of time, in the seed, so the nightly reseed
keeps it that way. A demo where everybody has minutes left never shows the
screen worth showing.

## The tests were passing without testing (2026-08-29)

`chk_not` reports PASS when its command fails. That is right for "the firewall
refused the connection" and catastrophically wrong for "the probe binary was not
installed". A missing binary exits 127, so on any machine without netcat these
assertions went green having checked nothing:

    kid cannot reach the main house LAN
    kid cannot reach the host postgres network
    kid cannot reach the tailnet
    kid cannot use DoH
    a static-IP squatter gets no internet
    a blocked kid loses the internet
    the vacuum cannot reach the rest of the internet
    a phone cannot reach the main house LAN
    a cut-off phone loses the internet
    a cut-off phone cannot use the camera grant as a way around it
    an unknown device gets no internet even under IoT policy

Eleven assertions across `container-test.sh` and `iot-policy-test.sh`, and they
are the guarantees the whole project rests on. Worse, the positive assertions
using the same probe failed at the same time, so a run read as "a few failures
on this distro" rather than "the harness is not executing", which is the most
misleading presentation available.

This was not hypothetical. A default Arch install has no netcat, and Arch is the
intended production gateway platform. The first parent to run these suites on a
minimal distro would have been told their children were isolated when nothing
had been checked.

Three changes, chosen to fix the class rather than the instance:

1. `chk_not` treats exit 127 as a hard failure and says the probe did not run.
2. **Every probe moved off netcat onto bash's own `/dev/tcp`.** Bash is already
   running the suite, so there is no external binary left to be missing. That is
   the actual fix: a guard against a missing tool only helps for the tools
   somebody thought to guard.
3. All seven suites fail loudly on a missing tool up front, and `nft` is
   discovered with `command -v` rather than hardcoded to `/usr/sbin/nft`. Debian
   and Ubuntu put it in `/usr/sbin`, Arch puts it in `/usr/bin` and keeps
   `/usr/sbin` only as a compatibility symlink. A distro without that symlink
   would have failed these suites in a way that reads as a firewall bug rather
   than a missing binary, which is the worst thing to hand somebody validating a
   new platform.

`adguard-test.sh` was audited and left alone: it uses curl, but every assertion
is a positive match against an expected value, so a broken probe fails rather
than passes.

The IoT half of this was found by a second agent auditing all seven suites after
the first two had been fixed. The lesson recorded here is that "I fixed the ones
I was looking at" is not a finished job when the defect is a pattern.

## The IoT policy was protecting nothing (2026-08-29)

`kidnet-iot-policy learn` resolved the vendor addresses correctly and then threw
them away. Several of a vendor's domains routinely resolve to the same CDN
address, and Postgres refuses an `ON CONFLICT DO UPDATE` that touches one row
twice in a single command. The error went to `/dev/null`, so the tool logged
"resolved 28 addresses" while storing none.

Every vendor-restricted device therefore had an empty allow list, and an empty
allow list is read by the firewall as no restriction at all. That fail-open is
deliberate and still right: "we have not learned the addresses yet" must never
mean "block the front door lock". But it means the camera lockdown this project
advertises had never actually been in force. `SELECT DISTINCT` fixes the write,
and the write no longer hides its own failures: a storage failure now logs the
Postgres error and raises an urgent alert.

Two related honesty fixes came with it:

- **The alert never cleared.** "Policy failed to validate, the previous rules
  are still in force" sat on the dashboard long after a later run succeeded. A
  banner that is no longer true is worse than no banner, because it teaches a
  parent to ignore the red ones. A good run now retires the failed runs before
  it, and the alert carries the nft error instead of dropping it.
- **A device on a lead that is not attached now says so.** A device set to
  vendor-only whose brand Hearth cannot identify is not restricted at all. That
  was a note in a terminal nobody reads. It is now a dashboard warning that
  names the device and prints the command that fixes it.

The general rule this is filed under: **a security control that silently does
nothing is worse than one that is switched off**, because the household believes
it is protected. Anything in this project that fails open must say so where a
parent will see it.

## Presence, ownership, and a cookie that switched itself on (2026-08-29)

Five fixes to the Devices page and the controls, grouped because they share a
cause: the page was confidently reporting things it did not know.

**Online was reading the lease, not the wire.** `last_seen` is refreshed from
the DHCP lease list, and a lease outlives the device that holds it by up to its
full duration, so a phone that left the house in the morning showed a green dot
all day. Presence now comes from the gateway's neighbour table, which only knows
about kit that has answered ARP recently, and is stored separately in
`present_at` (`config/db/schema-presence.sql`). "Seen before" and "here now" are
different questions and now have different columns.

**A duplicate lease crashed the scan.** One device can hold more than one lease,
a renewal on a new address or a static plus a dynamic entry, and Postgres cannot
apply `ON CONFLICT` to the same row twice in one statement. `DISTINCT ON` keeps
the newest row per MAC and per address. The same defect as the IoT one above,
found in a different tool on the same day, which is why both are written up
rather than quietly patched.

**The classifier was overwriting the parent.** An SMS gateway filed by hand as
an appliance reverted to a personal device on the next sweep. The guesser now
only touches devices nobody has ruled on: unknown kind, still on the default
class, no owner and no label. A guess must never beat a decision.

**The `dash` cookie was spelled `HttpOnly=false`.** Browsers key off the
attribute name alone, so writing it at all switched HttpOnly on. The page's own
script could then not read the token, every control POSTed to a 403, and the
client reloaded 600ms later straight over the error message. Gaming, media,
dinner, assignment: none of it worked, and none of it said so. The cookie is
fixed, and no control call reloads over a failure any more. The lesson kept: a
control that fails must never be allowed to erase the evidence that it failed.

**Phones with a randomised address are named.** Both iOS and Android rotate
their wifi MAC, and when they do the phone arrives as a new unnamed device and
quietly loses its owner, its tier and its metering. Two of three children were
uncovered this way and nothing had said so. The Devices page now flags those
phones and explains how to turn the rotation off for this network.

## The publish scanner had to stop crying wolf (2026-08-29)

`tools/publish.sh` checks the repo for things that must not go public. It was
failing on four things that are all fine: the author's name in `LICENSE` and the
design notes, the `guest-adult` and `guest-kid` role labels (rows in `children`,
but not anybody), and the MAC-shaped test fixtures. Its own comment warns that a
scanner which cries wolf is one people learn to ignore, and it was well on the
way to being exactly that.

Quietened on those four, it immediately found what it is actually for: example
parent names left in the voice documentation. Genericised.

The author's name is now pinned in the script rather than read from git's
`user.name`, which on this machine is an agency account. It is allowed in
`LICENSE` and `DECISIONS.md` and is a hard failure anywhere else, so a future
README rewrite cannot reintroduce it as an example.

Every child's name anywhere in this repo is invented. Most documents use Ada,
Ben and Cleo, `docs/HOUSEHOLD-ROLES.md` uses Robin, Toby and Elsie, and the
public demo's household is Piper, Rangi and Nova. The real names live only in
the database on the family's own box, and never in a tracked file.

## The parent could not make content, only switch it on (2026-08-30)

The Learn to earn screen let a parent decide who a bank was offered to and what
a pass paid them. It did not let them write one. Every quiz in the house came
from an agent editing JSON in `portal/quizzes`, which is fine for the person
who built this and useless for a parent on the couch. Three things followed
from that gap.

**Banks a parent writes live in the database, not the repo.** `portal/quizzes`
is tracked in git. A family's own bank sitting in there is one `git pull` away
from being deleted, and a spelling list for one child is not something to open
a pull request about. So `quiz_banks` and `quiz_bank_questions`
(`config/db/schema-quizbanks.sql`) hold them, and the portal merges the two
shelves at load: files first, then the database, a file winning a clash of ids.
The dashboard refuses to create an id a file already owns, so a clash means
somebody installed a file over the top, and installing a file is the more
deliberate act of the two.

**One rule bends, and it is the size rule.** A file bank needs four rounds'
worth of questions before the validator will pass it. A database bank goes live
once it holds one full round. A parent who has written twelve good questions
should not be told to write twenty-eight more before their child sees any of
them. The bank's card says "live, but small" and shows how far off four rounds
it is. Nothing else differs: same server-side grading, same difficulty ramp,
same cooldown, same cap.

**The earn numbers stopped being constants.** The cooldown, the daily cap, the
perfect-round bonus and the fallback price of a pass were four numbers in
`portal.mjs` that only an editor could change. They are now `earn_settings`,
one household row and an optional row per child, resolved by
`earn_settings_effective`, with the old constants as the last fallback. A
household that never opens the screen behaves exactly as it did. Each one is
explained in plain language on the screen itself, because a number with no
explanation gets set to something silly once and then never touched again.

**Performance is shown per question, not just per bank.** `quiz_rounds` and
`quiz_answers` already recorded every graded round including the failures, and
nothing read them back to the parent. A bank now shows its pass rate, its
average score, the questions nearly always got wrong and the ones nearly always
got right. A bank nobody passes writes no `time_events` row at all, so the
failures were the half of the picture that was invisible. The prompt text now
goes to the browser so those lists mean something; the choices and the answer
index still never leave the server.

**The AI half is a runbook and a briefing command, not a service.**
`bin/kidnet-quiz-suggest` gathers what one child passes, avoids, gets wrong and
has been looking up, and prints it with a prompt on the end.
`docs/runbooks/quiz-suggestions.md` is the recipe. The script calls no AI and
Hearth ships no scheduler for it: the recurrence and the model call are the
parent's own agent, and the briefing leaves the house only when a human pastes
it. That is the boundary, and it is a design position rather than a missing
feature.

Still not built, and said plainly in the runbook: nothing runs on a schedule,
nothing measures whether a suggestion worked, and a whole bank written as JSON
cannot be pasted into the dashboard. It goes in as a file through
`kidnet-quiz install`, or it is typed a question at a time.
