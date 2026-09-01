# How Genkan got here: the decision log

The reasoning behind the design, captured so the "why" isn't lost. Written
2026-08-27/28 from the conversation that built the project.

## The original ask

Tim: kids (11, 14, 16) won't get off their devices. Wants to control their
internet over WiFi, turn devices on/off, ideally by TALKING to the assistant
from his phone ("turn off Ben's internet", "kill kids wifi"). Also wants to
kill his son's Android MOBILE DATA.

## First reality checks

1. **The Genkan box is a LAN host, not the router.** The gateway is an ASUS at
   192.168.1.1 (SSH off). A host can't cleanly cut another device's traffic
   without controlling the router or ugly ARP tricks. So we needed the Genkan box to
   BE the gateway for the kids, on its own segment.
2. **Mobile data can't be touched by ANY router.** Cellular goes phone ->
   tower -> internet, never through the house. The only lever is Google
   Family Link (pause device / downtime, works over cellular). Tim already
   uses Family Link and is on Android for exactly this reason. Decision:
   Genkan owns HOME network time; Family Link owns the device + cellular;
   they run in parallel (no shared API, grant bonus in each separately).

## Hardware path (what we rejected and why)

- **Flash the Huawei HG659 with OpenWrt** -> impossible. Broadcom BCM63168,
  closed drivers, unsupported. Would brick it. Honest no.
- **OPNsense/pfSense** -> these are x86 whole-network firewalls, not router
  firmware. Overkill and the wrong shape (would route the whole house through
  a new box). Rejected for this job.
- **CHOSEN: the Genkan box as the kids' gateway** via a spare USB-ethernet adapter.
  Zero new OS, always-on, fully agent-controlled, ~$0. This is essentially
  "OPNsense-style control" but on the Linux box we already own.

## The topology we settled on

    ASUS (192.168.1.1) -> the Genkan box enp5s0 (uplink, unchanged)
                           the Genkan box kids0 (USB ASIX AX88179) = 192.168.60.1 gateway
                              -> spare switch
                                   -> son's wired PC
                                   -> TP-Link Deco X20 (AP MODE) -> kids' + guest WiFi

- USB NIC detected: ASIX AX88179 = kids0 (mac in config.env, gitignored).
- Deco X20 is APP-ONLY (no web UI / SSH / API). We don't need to control it:
  Tim flips it to Access Point mode ONCE via the app, then it's a dumb bridge
  and the Genkan box owns everything. Must NOT stay in router mode (it would NAT and
  hide devices behind one IP, defeating per-device control).
- Confirmed cabling (Tim, for his house layout): kids0 -> Deco port 1;
  Deco port 2 -> switch -> wired devices.
- DHCP: the Genkan box is the single DHCP+DNS server. Deco in AP mode runs neither.
- Guests join the SAME isolated island (internet yes; main network no).

## Security decisions

- **Segment isolation**: the kids/guest island cannot reach the main
  192.168.1.0/24 LAN where the Genkan box and all client work live. Guests get
  internet, nothing else. (nftables forward drop to RFC1918 internals.)
- **DNS forcing**: redirect all :53 to the Genkan box, block DoT (853), filter DoH,
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
- **The trick**: the Genkan box is the DNS server, so it knows which IPs belong to
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
  published at github.com/0800tim/genkan.

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
   hourly by `genkan allow-sync` (which resolves the domains, since the
   firewall matches addresses and these sites are CDN-hosted), placed above
   the block rules in the forward chain.

3. **A blocked device fell off the network instead of seeing the portal.**
   The input chain dropped blocked devices before the DHCP and DNS accepts, so
   "off" meant no address and no name resolution: pages fail silently, which
   is the exact thing the captive portal was built to prevent. DHCP, DNS and
   the portal are now unconditional, and the accepts are pinned to the gateway
   address (without that, `tcp dport 80 accept` matched every address the Genkan box
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
three-namespace lab (kid, the Genkan box, internet), loads the ruleset that ships, and
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
  (genkan NFT_DIRECT=1).
- **The DB is desired state; the firewall is a projection.** The gateway
  reconciles kids_block from Postgres every 15s in one atomic nft
  transaction. This is what lets the portal grant earned time by writing
  a row, survives restarts and replugs, and means genkan's direct nft
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

The repo is now public at github.com/0800tim/genkan. Everything above about
"not pushed yet" is history; docs/GO-PUBLIC-CHECKLIST.md carries what that
means for the items on it, including the history scrub.

A full documentation pass ran the same day, checking every document against
what the code actually does. Four things worth recording, because they are the
same failure mode each time: **a document that describes an intention in the
present tense is indistinguishable from a document that describes behaviour,
and only one of them is true.**

1. **Shipped features were undocumented.** Per-service byte accounting
   (genkan-servicemap, genkan-servicemeter, schema-services.sql) and device
   classification (genkan-classify, schema-devices.sql) both existed, were
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
2. **Shared front doors were metered.** `genkan-catmap` tagged any address that
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
3. **The address sets were add-only.** `genkan-catmeter` added to `gaming_ips`
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
reach a running island on a rebuild. `genkan-catmeter` therefore creates them
itself when they are absent, once, the same way `genkan-servicemeter` creates
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

Genkan runs on a box, and the box is the single point of failure for the whole
family's internet. There was nowhere to see whether it was full, hot or
thrashing. `/system` shows CPU, memory, disk, load, uptime, the Genkan
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

A stranger arriving at the repo could read about Genkan but not see it. Both
halves are now live: `demo.genkan.nz` is the parent's dashboard and
`quiz-demo.genkan.nz` is the child's captive portal with playable
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
- `bin/` is not mounted, so there would be no `genkan` to run.
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

`genkan-iot-policy learn` resolved the vendor addresses correctly and then threw
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
  vendor-only whose brand Genkan cannot identify is not restricted at all. That
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
`bin/genkan-quiz-suggest` gathers what one child passes, avoids, gets wrong and
has been looking up, and prints it with a prompt on the end.
`docs/runbooks/quiz-suggestions.md` is the recipe. The script calls no AI and
Genkan ships no scheduler for it: the recurrence and the model call are the
parent's own agent, and the briefing leaves the house only when a human pastes
it. That is the boundary, and it is a design position rather than a missing
feature.

Still not built, and said plainly in the runbook: nothing runs on a schedule,
nothing measures whether a suggestion worked, and a whole bank written as JSON
cannot be pasted into the dashboard. It goes in as a file through
`genkan-quiz install`, or it is typed a question at a time.

## Learn to earn was a memory test (2026-08-30)

A child out of time could reach the portal and the quizzes and nothing else. So
the only questions they could answer were ones they already knew the answer to.
The feature's whole claim is that effort earns time, and it was paying for
recall, which is a stock of knowledge a child already had rather than anything
they did that afternoon.

**A reading list that survives a total cut.** `scope='learn'` rows in
`always_allow`, resolved into the same `@kids_allow` nft set as the safety net,
because the firewall matches addresses and does not care why. Around forty
sites, seeded by `config/db/schema-learn.sql` and `schema-learn-intl.sql`.

**Two scopes, not one.** `safety` and `learn` sit in separate scopes even though
they land in the same firewall set, because the two promises are different and a
parent must be able to reason about them separately. Safety is the youth help
lines and it must never be narrowed. Learn is a reading list and it is a
household's to choose. Merging them would mean a parent trimming the reading
list could quietly trim 1737.

**The list rejects video sites, and that is the rule people argue with.** Five
tests: no social feed or messaging, not video-first, not aggressively monetised
at children, no account needed to read, and no route to general web content. The
second one did the most work. BBC Bitesize, ABC Education and PBS LearningMedia
all describe themselves, in their own marketing, as video libraries first. They
are good sites. They are also, to a child who has just been cut off for spending
too long watching things, a way back to watching things with a school's logo on
it. A list that lets in one video site has no principle left to refuse the next.
The same test rules out anything that is really a search engine wearing a
library's name, Trove included, because a search box is a route to the whole web.

**Deliberately dull, and deliberately short.** A short list that actually passes
those tests is worth more than a long one that quietly fails a couple. Every
rejection in `docs/READING-LIST.md` is a real one: a site that looked like an
obvious yes until it was checked.

The honest gap this opened: Genkan still cannot see that a child spent forty
minutes reading before the round, so it pays them exactly the same as a child
who guessed well. The signal exists (`dns_log`, and now `quiz_study_visits`) and
nothing prices it. `LEARN-TO-EARN.md` keeps that open.

## A curriculum, not a demo (2026-08-30)

Eight quiz banks was enough to prove the mechanism and not enough for a real
child to live on. A ten year old exhausts the interesting half of eight banks in
a fortnight, and then learn-to-earn is a chore with a cooldown on it.

Over 40 banks now, more than 2,000 questions, NZ Years 1 to 3 through NCEA
across every learning area including Aotearoa New Zealand histories, te reo
Māori, the arts and health and PE, plus the UK, the US, Australia, Canada and
Ireland and a set of general-interest banks. Three rules held while writing
them.

**Every question carries an explanation.** Not a right-or-wrong tick: a sentence
written for the child who got it wrong. This is the single most load-bearing
rule in the format, because the explanation is the study material. A bank
without them is a test, and a test does not teach anybody anything.

**Every question carries a difficulty, including the original eight.** The ramp
shipped before the banks did, and the eight banks written before it had no
`difficulty` fields, so they were sampled flat while every new bank ramped. Two
classes of bank behaving differently is the kind of inconsistency nobody
remembers six months later, so the eight were backfilled rather than left as a
documented exception.

**A study page per bank.** `/study/<bank>` in the portal lists every question,
its answer and its explanation. No cooldown, no cap and no round token, because
reading earns nothing and there is therefore nothing to farm. It is the answer
to "I got three out of ten and I do not know why".

What this is not, said plainly here and in the README: a validated curriculum.
Nobody has marked it against a syllabus document. Coverage is broad but uneven
because it grew out of what real children in one house were actually studying:
maths has a bank per year band and te reo Māori has one beginners bank. It is a
large, carefully
fact-checked set of questions meant to sit alongside school rather than replace
any of it. Claiming more than that would be the easiest lie in the project to
tell and the fastest one to be caught in by a teacher.

## Badges, and why the house board is not a leaderboard (2026-08-30)

The ask was blunt: badges, and get the siblings battling each other on an
achievement board. Badges got built. The battle did not.

**A raw leaderboard punishes the youngest by construction.** Rank children on
total minutes earned or total rounds passed and the seven year old loses to the
fifteen year old every single day, forever, and no amount of effort changes it.
A feature meant to make learning feel good would be a daily reminder of a race
they were entered into and cannot win. Public failure motivates the child who is
already winning.

**The mechanics that were refused, and why.** A streak that breaks is a
punishment dressed as a reward, and "don't break the chain" is a tool of the
attention economy this project exists to push back against: importing it into
the one part of Genkan that is meant to feel unlike a phone would be copying the
enemy's toolkit. A handicap multiplier for the younger child is still a formula
standing between a child and an honest answer to "how am I doing", and a clever
kid will treat it as a puzzle while a parent has to defend it.

**So badges are personal.** Every one is a milestone against a child's own
history: first pass, first perfect round, ten passes, a bank mastered, tried
something new. Awarded with `ON CONFLICT DO NOTHING` on a unique index, so a
retried request can never hand out a second row to gloat over.

**And the one comparison that ships is chosen so age does not win it.** The
house board deals only in improvement lately, how many different banks somebody
has tried, how often they came back after a flop, and how much they read up.
Every one of those is available to a seven year old on the same terms as a
fifteen year old.

**It is off by default** (`board_settings.enabled`). A household should not pull
an update and find a new social feature between their children. A child's own
badges and their own earnings are always visible to that child, whatever the
switch says. Full reasoning in `docs/GAMIFICATION.md`.

## A device nobody has claimed should not get the whole internet (2026-08-30)

The island was default-deny by source address, and a DHCP lease was what got you
into `@kids_known`. Which meant a lease was the whole identity check: plug in a
new phone, get a lease, get unfiltered internet, because no child owned it and
so no child's rules applied. Every control in Genkan hangs off "whose device is
this", and the answer was "whoever asked for an address".

**Claiming, not logging in.** A login needs a credential per child, which means
a password a child can share, forget, or find written down. Instead an
unrecognised device is restricted until somebody says whose it is, and the
device is told so on a page rather than left looking broken.

**A child's claim grants nothing on its own.** This is the decision that matters.
A self-claim marks the device `claim_pending` and it **stays** in the restricted
lane until a parent confirms it. An earlier draft let a pending device run at
the house's tightest filter level instead, on the reasoning that some access is
better than none. That does not work, because a time budget belongs to a child
and not to a device: a younger child claiming the eldest's name would inherit
her clock, and in this household the eldest has no daily limit at all. Unlimited
time was exactly the prize worth lying for. With confirmation required, lying at
the claim page gains a child precisely nothing, so there is no reason to try it
and no arms race to run.

**Below the safety net, never below it in importance.** The `kids_unclaimed`
drop rule sits underneath `@kids_allow` in the ruleset, so an unclaimed device
still reaches the help lines and the reading list, and its port 80 is redirected
to the portal. A device nobody has named is still a person, and possibly a
person in trouble.

**Off by default**, with an observe mode. `claim_settings.mode` ships as `off`,
so a household that pulls this update sees no change at all. Observe restricts
nothing and reports what enforcing would catch, because on a house that has been
running a while that number is always higher than expected. The same call
`schema-badges.sql` made, for the same reason.

## Attacking our own box, and four things it found (2026-08-30)

A security review and an adversarial pen test of the surface, filed as
`research/security-review-2026-08-30.md` and `research/pentest-2026-08-30.md`.
Four findings, and each one changed a rule rather than just a line.

**SQL injection reachable from the dashboard API.** `genkan recent` and `genkan
topsites` interpolated their row limit straight into SQL. Both are on the
dashboard's HTTP allowlist, and `psql -c` will happily run a second statement,
as the Postgres superuser. Proven end to end before it was fixed. Every argument
now goes through one of the gates, and the rule written next to them is that a
limit is not exempt: it was the argument that was obviously a number that nobody
thought to gate. The command-line-only sites (`assign`, `infra`, the audit
trail, the minutes and reasons, the ids read back out of the database) were left
for a second pass; that pass is the next entry.

**One DNS lookup could switch off every safety alert.** A DNS label may
legitimately contain a dot, and AdGuard stores that as a literal backslash-dot.
`genkan-dnslog` fed the stored name into `COPY ... FORMAT text`, whose backslash
grammar aborts on it. The transaction rolled back, and because the next run keys
off `max(ts)` in `dns_log`, the same poison was fetched and failed again, for
good. `genkan-alerts` reads `dns_log`, so while that was stalled no Tor,
darknet, drugs, VPN or self-harm alert could fire and nothing on the dashboard
said so. It also gave per-lookup evasion: send one poison query and the batch
carrying the lookup you did not want seen goes with it. One `dig` from a laptop
was the whole attack. CSV has no backslash grammar, so that is what it uses now,
and a failed ingest raises an urgent alert and exits non-zero. **The silence was
the real damage, not the parse error.**

**The portal's `?kid=` override trusted the URL.** It was meant as a parent's
preview from the dashboard. Any device on the island could name any child and
read their minutes, tasks and history. No writes, but a sibling on a new phone
could see exactly how much time you had left, which is precisely the sort of
thing siblings do. It now needs `PORTAL_PREVIEW_TOKEN`, which only the dashboard
holds and which is absent from the household's own portal container, so a device
on the island cannot use the override at all.

**The publish scanner printed a clean board when its checks had not run.** Two
checks, real children's names and author placement, printed nothing when the
database did not answer or `HEARTH_AUTHOR` was unset. Not a warning: nothing.
The two most valuable checks in the file were the two that failed open. They now
report a check that could not run as a leak, because that is the safe reading.
It was also blind to binaries, since `grep -I` skips them, and a screenshot of
the dashboard is the single most likely way a child's name, a MAC and a private
address leave a house at once. Binaries are refused outright rather than
scanned.

The pattern in three of the four is the same one the test suites taught us on
2026-08-29: **a check that cannot run must fail loudly, never quietly.** Silence
reads as success to everybody who looks at it.

## A bad git command destroyed uncommitted work (2026-08-30)

`git checkout dashboard/portal.mjs` discarded an agent's uncommitted work and
there was nothing to recover from. Good intentions and a careful rule about
which git commands to run are not a safeguard, because the whole failure mode is
somebody running the command anyway.

`tools/worktree-snapshot.sh save` commits the entire working tree, tracked and
untracked, to `refs/hearth/snapshots` every couple of minutes. Three properties
make it safe to leave running:

- **A separate ref.** It never appears in branch history and is never pushed, so
  it cannot pollute a commit or a pull request.
- **Its own index file.** It never disturbs what is staged for a real commit. A
  safeguard that surprises the person it is protecting gets turned off.
- **Ordinary git underneath.** Recovery is `git show <ref>:<path>`, readable by
  any git tool. A bespoke backup format would be one more thing to be broken at
  exactly the moment it is needed.

It skips the commit when nothing has changed, and git deduplicates blobs, so
snapshotting an unchanged tree costs almost nothing.

**The script is in the repo, the timer is not.** How often a box snapshots, or
whether it does at all, is not a household concern, and a family running Genkan
does not need this at all. It is a development safeguard and `docs/CLI.md` says
so.

## Bedtimes ran themselves, and set_by decided who may lift what (2026-08-30)

An outside reviewer called scheduled bedtimes the largest functional omission,
and they were right. The `schedules` table had been in `schema.sql` since the
first night and nothing read it. Every bedtime in this house was a parent
typing `genkan off kids` at nine and remembering to type `genkan on kids` at
seven. The remembering is the part that failed. **A child who wakes to a dead
network because nothing lifted it has been punished by an oversight**, so the
morning restore is the half that matters, not the bedtime.

`bin/genkan-schedule` runs every minute. What is new is not the timer, it is
the precedence rules, because that is the part somebody will get wrong later.

### The precedence table

`category_state.set_by` already said who put a block there. It now decides who
may take it away.

| `set_by` | who set it | who may lift it |
|---|---|---|
| `agent` | a parent, by hand or on the dashboard | a parent |
| `out-of-time` | `genkan-meter`, at zero minutes | earning, and a parent |
| `over-budget` | `genkan-catmeter`, a category over its cap | `genkan grant`, and a parent |
| `bedtime` | `genkan-schedule` | `genkan-schedule`, and a parent |
| `earned-back` | the portal or `genkan reopen` | not a block |
| `schedule-lifted` | `genkan-schedule`, in the morning | not a block |

Five rules fall out of it, and each one is a real failure that was possible
before it:

**A schedule never lifts a block it did not apply.** The morning lift is
`UPDATE ... WHERE blocked AND set_by='bedtime'`. If Dad said no gaming today,
the sun coming up does not undo it.

**A parent always beats a schedule, and the override lasts until the next
boundary.** Turning the internet back on at half past ten writes
`set_by='agent'`, and the worker would have re-blocked it sixty seconds later.
So the worker keeps one row per child, schedule and category
(`schedule_state`) holding the key of the window it has taken responsibility
for. Finding that window unblocked after it had asserted means a person did
that, and it records a release against that same key. The key is the schedule
id plus **the date the window started**, so the release cannot leak into
tomorrow night and nothing has to clean it up.

**Earning time cannot buy a way past bedtime.** This one was actually broken.
`genkan bonus` and `genkan earn` ended with `internet <kid> on`, which stamps
`set_by='agent'` over whatever was in the row, bedtime included. So did the
dashboard's chore approval. A quiz passed at half past ten reopened the night.
Both now call `genkan reopen`, which clears an internet block only where
`set_by` is `out-of-time` or `earned-back`. The portal had been doing exactly
that since it was written; the CLI had not. **Time can be earned. Bedtime
cannot be bought.**

**A restart must not restore access.** Two halves. The block is a row in
Postgres and the gateway reconciles the firewall from it every 15 seconds, so a
reboot at eleven comes back blocked without the worker doing anything, and
nothing in the boot path writes to `category_state`. The other half is the
worker's own memory: **an empty `schedule_state` means assert.** A restored
backup, or a fresh state table, cannot be told apart from a parent override
unless the worker has a record of having asserted, so with no record it fails
towards the bedtime being in force rather than towards the child being online.
That direction is the whole point. A parent's release does survive a restart,
because the release is a row too.

**Nothing but the worker touches a block.** The dashboard's `/api/schedule`
writes times, dates and extensions, and then asks the worker to run. The rules
above live in one script and one schema file, not in three places that will
drift.

### Two smaller shapes worth keeping

**The lift is driven off `category_state`, not off `schedules`.** "Anything
still marked `bedtime` that no window in force calls for" survives a schedule
being deleted, disabled or edited mid-window. Driving it off the schedules
table would have left a child blocked by a bedtime that no longer existed, with
nothing left to lift it. That is the shape of an outage nobody can diagnose.

**The time maths takes the moment as an argument.** `schedule_windows(at
timestamptz)` is a SQL function rather than logic in bash, so
`test/schedule-test.sh` can prove a Tuesday, a Friday night and a Saturday
morning at fixed timestamps instead of waiting for them, and so the worker, the
dashboard and the kid portal read one answer rather than three
implementations. It runs in the database's own timezone, which is the same
clock the daily budget rolls over on, so a bedtime and a day boundary cannot
disagree.

`days` is the night the window **starts** on, and an end time earlier than the
start means it crosses midnight. Both are the reading a parent already has:
"Friday night, nine till seven" is one thing, not two.

### Shipped enabled, unlike the IoT timer

`kids-iot-policy.timer` is installed and deliberately left off. This one is
installed and enabled, and the difference is worth stating because the two look
like the same decision.

The IoT policy does something the moment it runs. The scheduler does not: with
no rows in `schedules`, and a fresh install has none, it is a no-op. **The
switch is the data, not the unit.** So the failure to design against is not "a
timer nobody asked for changed something", it is a parent setting a bedtime on
the dashboard and it silently never firing because a unit they have never heard
of was left disabled. A feature that fails silently is worse than one that is
absent, and this one fails at nine at night with a child watching.

### What it still cannot do

The window is per child and per set of days. It cannot say "off at nine, but
half an hour later if they finished their homework", and it has no idea whether
anyone is asleep. A holiday window suspends bedtimes by date; it does not know
about a term calendar and will not learn one. `late` moves the evening only and
leaves the morning where it is, because a child locked out later than a parent
meant is the failure worth avoiding and moving the far end is the only way to
cause it.

## The CLI stops being a superuser (2026-08-30)

An external reviewer read the repo cold, as a cautious parent would, and made
two points that were both right. Some command-line SQL interpolation was still
ungated. And, more seriously: everything Genkan's CLI does ran as the Postgres
**superuser**, on an instance this box shares with unrelated projects.

The second one is the finding, and it is not really about injection.

### Why superuser was the whole game

`psqll()` was `docker exec -i postgres psql -U postgres -d kids_network -tAc`.
A superuser connection can run `COPY ... TO PROGRAM`, which executes a shell
command inside the database container, and it can read and write every other
database on the server. So the distance between "a device label with a quote in
it reached a WHERE clause" and "somebody owns the box" was one statement. The
gates in `bin/genkan` were the only thing in the way, and a gate is a thing that
can be forgotten: the 2026-08-30 review found four sites that had been.

`bin/genkan`, every `bin/genkan-*` worker and the two operator tools that read
the database now connect as **`kids_agent`**, whose grants are one line per
table in `config/db/grants.sql`, each with a comment naming the script that
needs it. It is not a superuser, owns nothing, is a member of no role, and has
no password, so it is reachable only over the local socket inside the Postgres
container. `COPY ... TO PROGRAM` is refused. So is reading a server file,
dropping or truncating a table, deleting a child or a day of history, and making
itself a superuser. `test/db-role-test.sh` proves each of those by trying it.

**Two roles, two jobs.** The obvious shortcut was to put the CLI on `kids_app`,
which already existed. That was the wrong move: `kids_app` is the role the
dashboard and the kid portal hold over HTTP, and the CLI needs writes the web
surface has no business having. Widening the HTTP role to save creating a
second one would have paid for a smaller attack surface in one place with a
larger one somewhere worse.

### Least privilege has to be found, not guessed

The grant list was not written from reading the code. It was written by running
the CLI as the restricted role against a throwaway database and fixing each
`permission denied` with the narrowest grant that made that one command work.
That is slower and it is the only way the list ends up honest: reading the code
tells you what the scripts appear to touch, running them tells you what they do.

A useful thing fell out of it. Views in this schema are owned by the loader, so
a view runs with its owner's rights on the tables underneath: `SELECT` on
`device_policy_effective` is enough, and `kids_agent` needs no rights at all on
`device_class_policy` or `device_policy` to read it. Several tables stayed off
the list entirely because of that.

### What stays on the superuser path, and says so

Creating the role and loading the schema (`config/db/load.sh`), pinning the
database timezone and applying the grants (`deploy.sh`), rebuilding the public
demo from nothing (`demo/reseed.sh`), and taking or restoring a dump
(`genkan-upgrade`, `genkan-rollback --with-db`). Each is work a least-privilege
role must not be able to do for itself, each is commented at the call site with
the words SUPERUSER PATH and the reason, and the demo one only ever talks to a
throwaway container with a made-up family in it. The convention is the point:
a superuser connection in this tree has to justify itself in a comment, so the
next one is a decision rather than a habit.

### The database is also closed to the rest of the server

Postgres lets `PUBLIC` connect to a new database by default, so any role on this
shared instance could open `kids_network` and read the catalogue. Only
`kids_app`, `kids_agent` and a superuser may now. The mirror of that, fencing
`kids_agent` out of other projects' databases, is deliberately **not** done:
that would mean editing an ACL Genkan does not own, on a server other people's
production runs on. It is written down in `docs/OPERATIONS.md` as a one-line
thing a household can choose to do, with the caveat attached.

### And the rest of the interpolations

Fifty-five argument sites are now gated that were not. Twenty-four in
`bin/genkan` alone: all four values in the audit trail, the id, category and
boolean in `setcat_id`, the signed minutes and the reason in `addtime`, the
child id in `ensure_day`, `remaining`, `spend`, `time`, `grant` and both guest
verbs, and the MAC or address and the optional reservation in `assign` and
`infra`. Then ten in `genkan-iot-policy` (device ids, the vendor id, the vendor
names that become nft set names, and the island subnet from `config.env`), six
in `genkan-catmeter` and four in `genkan-servicemeter` (the category, the
address off an nft counter, the byte count and the child id), three in
`genkan-report` (both week bounds and the child id), two in `genkan-classify`,
and one each in `genkan-alerts` (the lookback window), `genkan-devicescan` (the
neighbour list), `genkan-quiz`, `genkan-quiz-suggest`, the gateway's `alert()`
severity and `deploy.sh`'s timezone.

Three rules came out of doing it.

**An id from the database is still an argument.** Most of these values are read
back out of Postgres, not typed by a parent, and the temptation is to trust
them for that reason. That is the assumption that turns one bad write into a
second injection, so `ck_id` is applied to every one of them.

**Gate before you query, not beside the statement.** `genkan assign` checked its
optional reservation next to the statement that used it, which sat after the
person lookup. So whether a bad reservation was refused depended on whether the
person existed. A gate whose answer depends on the data is not a gate. Every
argument is now checked before the first connection is opened.

**Where a value cannot pass a gate, quote it, do not widen the gate.** The
vendor names and alert details that legitimately carry spaces and brackets go
through quote-doubling at the call site. Widening `ck_text` to admit them would
have loosened it for the forty places that do not need it.

## The family iPad had nowhere to live (2026-08-30)

Tim: "I've got an iPad that basically all the kids use, and also the smart TVs
in that category. We do want to have maybe tick boxes to say that these devices
get killed during dinnertime. That can be a button that is just complete
outage, all devices off. Obviously, if we've got some appliance devices they
wouldn't get included, but kid devices would."

An outside reviewer put the same thing more sharply: a television does not
belong to one child, and Genkan identifies the device, not the person holding
the remote.

Until now that iPad had two homes and both were wrong. Give it to one child and
that child pays for the family film out of their own minutes, and the parent
finds out on Sunday when the digest says the seven year old watched four hours.
Give it to nobody and it escapes every budget, every filter level and every
control there is, which is the worse of the two.

### A fifth class, not a flag on the fourth

`shared` joins `personal`, `iot`, `appliance` and `infra`. It is a class rather
than a boolean on `personal` because the three facts that follow from it are all
different from a personal device's: no owner ever, a filter level of its own,
and a sweep membership the parent chooses. A boolean would have meant every
query that says `category='personal'` growing an `OR`, and there are eleven of
them across `bin/` and `dashboard/`, each one a chance to forget.

The shape falls out of that. `child_id` is always NULL on a shared device, so
`people_devices`, `genkan-meter`, `genkan-adguard-clients` and the weekly digest
skip it by construction rather than by remembering to exclude it. The one thing
that had to be added rather than inherited is filtering: a device with no owner
has no tier, and a device with no tier falls through to the AdGuard household
catch-all, which blocks ads and malware and nothing else. So `devices` gained a
`policy_tier` of its own, a shared device gets its own AdGuard client named
after it, and filing something as shared defaults it to Standard. An unfiltered
television in the lounge is a worse outcome than a wrongly billed one, and the
unsafe answer should never be the one a parent gets by not choosing.

### NULL means "the default for this class"

The two tick boxes are `caught_by_dinner` and `caught_by_house_off`, and both
are nullable rather than `NOT NULL DEFAULT true`. NULL means "whatever this
class does by default".

That buys two things. Re-filing a phone as a shared device picks up the shared
defaults instead of dragging an answer about a phone across to a television. And
the Devices page can say **(default)** honestly, rather than drawing a ticked
box that claims the parent decided something they never touched. The brief asked
for a shared device to default into the dinner pause *and ask the parent*; a
tri-state column is what "and ask" looks like in a schema.

Defaults per class: personal in both, shared in both, and `iot`, `appliance` and
`infra` in neither, always. A whole-house cut that leaves the family television
streaming is not a whole-house cut, so shared defaults into that one too, and
the page marks it as a default and invites the change. The kitchen display that
plays music through dinner is one untick.

### The iron rule got a second home, and both are computed

The existing guard was `ips_in_scope()`: only `personal` addresses come out of
it, so no scope can reach a lock or a camera. Two tick-box columns are a new way
to break that, because a row can now *say* the camera goes off at dinner.

So the answer is not the column. `device_sweeps` computes it, and forces `false`
for `iot`, `appliance` and `infra` whatever the columns hold. A hand-edited row,
a bad migration or a future bug in the dashboard cannot put the front door lock
in a dinner pause, because the value it would have to change is not stored
anywhere. `test/schema-test.sh` proves it the only way worth proving it: it puts
one device of every class on the wire, forces both columns ON for all of them,
and checks the three that must never be cut are in neither sweep.

The dashboard refuses the tick as well, so a parent is told rather than left
thinking they changed something. That is a courtesy, not the guard.

### The whole-house cut writes nothing, and lifts itself

The obvious way to build "all devices off" is to write a block against every
device. The obvious way that goes wrong is a parent pressing it on the way out
the door with nobody home to press the other one, and Tim asked what happens
then before he asked for anything else about it.

So no rows are written against any device at all. `house_state` holds a single
timestamp, `off_until`. The `blocked_device_ips` view reads the clock. When the
moment passes the addresses simply stop being in the set on the gateway's next
fifteen-second reconcile. There is no worker to fail, no timer to install, and
nothing left behind to go stale: the cut cannot outlive the reason for it,
because the reason for it *is* the clock. `genkan house on` is the same single
UPDATE. Default sixty minutes, capped at a day.

Ending a cut early takes out only the addresses nothing else still says should
be blocked, so `house on` cannot hand the internet back to a child who is out of
time or who was switched off separately.

`house-off` is a scope in `ips_in_scope()` but deliberately NOT in `bin/genkan`'s
scope list, so `genkan off house-off` is refused. A whole-house cut with no
expiry is exactly the foot-gun this design exists to remove, and leaving a second
door to it open would have put it straight back.

### A shared device needed block state the reconciler could see

`category_state` is keyed on a child, and the gateway rebuilds `@kids_block`
from it every fifteen seconds. A shared device has no child, so a block written
straight into nftables would have been scrubbed on the next tick, and `genkan
dinner` would have turned the television off for fifteen seconds. `device_state`
is the same idea keyed on the device.

While moving that query into the database (`blocked_device_ips`) two things came
out of the old one in `gateway/entrypoint.sh`. It joined on `child_id` alone
with no class check, so a camera that had somehow been handed to a child would
have gone dark with them; nothing in `bin/genkan` can produce that row, but the
iron rule should not depend on that staying true. And `reconcile_set` could not
tell an empty answer from a failed query: a view the image expects but the
database has not been given yet produced no rows, which read as "nothing should
be blocked", and the next line flushed `@kids_block` and handed every cut-off
child the internet back. A failed query now changes nothing.

### What is not built: a shared budget

A shared device has no clock of its own. It is filtered, it is swept, and it
costs nobody any minutes, but there is no daily allowance for the family
television and no "the iPad has had two hours today".

That was offered as optional and it is genuinely a lot more work, so it is not
half built. Everything about time in Genkan is keyed on a child: `time_ledger`
and `time_remaining`, `genkan spend` and `genkan bonus`, `genkan-meter` walking
children rather than devices, `category_budgets`, the earn and quiz paths that
add minutes back, and the captive portal that explains to a named child what
happened and what they can do about it. A device-level budget is a second full
metering path through every one of those, not a column, and it also has to
answer questions a per-child budget never asks: does the television's hour reset
at midnight or roll, can a child spend their own minutes on it, and who does the
portal address when nobody owns the device it is showing.

A budget that silently does not enforce is worse than no budget at all, so:

**Next step, written down rather than done.** A `device_budgets` table mirroring
`category_budgets`, a `device_usage` day ledger, a device branch in
`genkan-meter`, a `genkan spend-device` verb, and a portal page for a device
with no owner. Roughly the size of the metering work in METERING.md, and it
should be done as one piece with tests, not bolted on.

## Anyone should be able to teach something, and model aeroplanes count (2026-08-30)

The ask was plain:

> "Just make sure you build it in a way that's easy for other people to
> contribute to, because there are all sorts of people that have got good things
> to teach. It could just be how to make model aeroplanes and how to paint,
> stuff that's outside the curriculum but still valuable life lessons."

Two things had to change for that to be true. A bank was a bare JSON file of
questions: no author, no licence, nothing about who it was for, and nothing a
child could read before answering. And the only way to get one to a household
was to put it in `portal/quizzes/`, which is tracked in git, so somebody else's
content arrived by repository update and left the same way.

### A package is a bank plus a manifest, in one file

The format is the existing bank format with one optional `package` block on top:
`author`, `licence`, `description`, `tags`, `sources`, and an optional
`read_first` page. Nothing was renamed and nothing was moved, so forty-one of
the forty-two banks that ship with Genkan pass every package check unchanged,
manifest aside. The forty-second fails on an explanation of 404 characters, which is a real
pre-existing bug rather than a format problem: the `quiz_bank_questions`
constraint stops at 400, so that bank could never have been installed into the
database anyway.

**One file, because one file is the thing a person can actually send.** It can
be emailed, attached to an issue, dropped in a folder, or put in a pull request
by somebody who has never used git. Anything that needed a directory, a
manifest file and an archive would have cut out most of the people this is for.

Nesting the manifest under one key rather than adding six top-level fields is
what makes the two formats the same format. A bank with no `package` block is a
package with no manifest, and the validator says so as a note rather than an
error unless you pass `--strict`.

### Installed packages live in the database

Same reasoning as the dashboard's own bank editor: `portal/quizzes` is tracked
in git and a `git pull` would delete a family's content. So
`bin/genkan-pack install` writes to `quiz_banks`, `quiz_bank_questions` and a
new `quiz_packages` manifest table, and `portal/quizzes/community/` becomes a
**shelf** rather than a live directory. The portal reads only `*.json` at the
top of `portal/quizzes`, so a package sitting on the shelf is invisible to every
child until somebody says yes to it.

Installing is a terminal command and not a dashboard button, on purpose. It is a
stranger's writing going in front of a child, and that should take a deliberate
act by somebody who has read it.

### The whole package goes in as one jsonb value

`install_quiz_package(jsonb, ...)` takes the entire package and does the work
inside one transaction. Three reasons, in order of how much they mattered: a
package can never land half in; there is one string to quote instead of
hundreds, which is the difference between one quoting bug and forty; and the
existing constraints in `schema-quizbanks.sql` apply to a stranger's content
exactly as they apply to a bank a parent typed.

It is `SECURITY DEFINER`, which arrived for a better reason than convenience.
`config/db/grants.sql` had just moved the CLI onto `kids_agent`, a role with no
DDL and no write access to the quiz tables. Installing a package as that role
would otherwise have meant granting INSERT, UPDATE and DELETE on `quiz_banks`
and `quiz_bank_questions`, which is far more than the job needs. One narrow
audited function is less privilege, not more. `remove_quiz_package()` refuses
any bank that did not arrive as a package, so it cannot delete a bank a parent
wrote on the dashboard whatever id it is handed.

### A package is hostile input, and that drove most of the design

A stored cross-site scripting hole in the kid portal, arriving through a quiz in
a pull request, would be the worst bug this product could ship: it would run in
the portal's origin, on the island, on the machine a parent believes is the
safest thing on their network. So there are two independent defences and
`test/package-test.sh` proves them separately, which is the only way to know
they are independent.

`tools/validate-package.mjs` treats every string as hostile. The rule that does
most of the work is deliberately one rule, so it can be explained to somebody
who is not a programmer: **`<`, `>` and `&` have to stand on their own, with a
space either side.** "7 < 8" is fine, "salt & pepper" is fine, and `<script>`,
`<img`, `&amp;` and `&#60;` are all gone. On top of that: no invisible or
right-to-left characters, no `javascript:` or `data:` URLs, no event handler
names, sizes on every field that match the database columns, and links that must
be https and must point at a domain already on the reading list.

The reading list rule is not gatekeeping. A child on the Read up page is usually
a child who has run out of time, and their device can reach the portal and about
forty reference sites. Any other link is dead on arrival at the exact moment it
was needed.

One exception was earned by real content. The arrow `->` is how every chemistry
bank in the repo writes a reaction, and four banks broke on it. Telling a
science teacher to stop writing `2H2 + O2 -> 2H2O` would have been the rule
making the product worse, so the arrow is removed before the test runs. It
cannot close an HTML comment the rule will not let anybody open.

The second defence is that the portal escapes everything anyway. Part 3 of the
suite forces a payload straight into the database by hand, past the validator
and past the CLI, then renders it with the `esc()` function lifted out of
`dashboard/portal.mjs` at run time rather than copied, and asserts that no tag
survives that the test did not write itself. Reading the function out of the
real file is what makes the test fail if somebody ever weakens it.

### Pictures are not supported, and saying so was the decision

A painting module wants a colour wheel. A model aeroplane module wants a photo
of a wing section. Neither can have one, and adding an `image` field that
silently did nothing would have been worse than the gap.

Three real obstacles. The portal builds HTML strings inside the island's netns
and has no static file directory or asset pipeline. A link to an outside image
fails to load for exactly the child who needs it, because they can only reach
the reading list. And embedding images in the JSON turns a 60 KB package into
several megabytes, which stops being a thing you can attach to an issue.

What it would take is written down in `docs/CONTRIBUTING-CONTENT.md`: an asset
directory served from inside the island, a per-package size budget, a type
allowlist with file contents checked rather than trusted, a way to carry binary
files through a pull request, and a rule for what happens to an installed
package's images when it is removed. That is a piece of work, not a field.

What can be done today is to write the picture in words and point at a diagram
on the reading list. The worked example teaches colour mixing with no colour
wheel on the screen at all, which is evidence that this survives better than it
sounds.

### The dashboard alert was deliberately not built

The ask ended with parents getting alerts about packages an AI thinks would suit
their children. Building a convincing fake of that would have been easy and
wrong.

What was built is the part that is real: the Learn to earn screen lists the
packages installed on the box and the ones sitting on the shelf, with the author
and the licence on each, and a table that says in plain words what is built,
what is not, and what is not supported. The "not built" row names the missing
piece rather than describing it in the present tense.

The important half is the shape the missing piece has to take. **Genkan has no
telemetry and calls no cloud**, so this will never be a service that watches a
family and recommends things to them. The evidence half already exists and calls
nothing: `bin/genkan-quiz-suggest <child>` reads the household's own database
and prints a briefing, `bin/genkan-pack list` prints the shelf, and
`docs/runbooks/quiz-suggestions.md` gained a step 8 telling an agent to check the
shelf before writing anything and to recommend rather than install. The matching
is done by an agent the parent runs, on the parent's box, with the parent
pasting the briefing in. That is not a limitation to engineer away later. It is
the design.

## The slow lane: why turning it down beats turning it off

Added 2026-08-30. The idea is borrowed honestly: Firewalla ships "disturb"
rules, which degrade an addictive service instead of blocking it. It is the
best idea in the competitive landscape and it fits Genkan better than it fits
Firewalla, because Genkan's whole position is that the household should be able
to explain every decision to the child it lands on.

### The argument

A hard block is a confrontation. The video stops dead, the child comes to find
you, and you have the argument this product exists to avoid. You have also
taught them very little: the lesson of a wall is that somebody else controls
the wall, and the natural response is to look for a way around it.

A slow lane is a different lesson. The video still plays, it just buffers.
Scrolling stutters. Nothing announces itself as a punishment, and after a few
minutes the child gets bored and goes and does something else. They stopped
because it stopped being fun, which is exactly the judgement we want them to
learn to make on their own. Nobody was told no, so there is nothing to resent
and nothing to push against.

It is also much harder to game. A block is a binary you can look for a bypass
to. A slow lane just feels like a mediocre evening on the internet.

### Why it is a state on `category_state`, not a table of its own

"Slow" is not a different kind of control from "off". It is the gentler setting
of the same one. So it is a `speed` column on the row the block already lives
on, and a category is in exactly one of three states:

    off    blocked = true                    the hard cut, unchanged
    slow   blocked = false, speed = 'slow'   policed down, never cut
    full   blocked = false, speed = 'full'   the default

One row, one place to read, and the ordering falls out for free: a dropped
packet is never policed, so "off" always wins over "slow" without any code
having to say so. A parallel table would have needed a rule about which one
won, and that rule would have been wrong somewhere.

### Why nftables and not `tc`

`tc` is the obvious tool and it was rejected. It would have meant a second
enforcement plane, with its own state, its own reconciler and its own way of
disagreeing with the firewall about who is being controlled right now. Genkan's
whole architecture is that Postgres holds the desired state and the firewall is
a projection of it, reconciled every fifteen seconds. Rate limiting in
nftables lives in the same ruleset, is rebuilt by the same loop and is proven
by the same test suite.

It is policing rather than shaping, and that is a real trade: a policer drops
packets instead of queueing them, so a throttled connection is lossy as well as
slow. For this job that is a feature. Loss is what makes a video player give up
and show the spinner, which is the whole effect we are after.

Per device, not per household: each rule uses a `meter` keyed on the island
address, so two throttled children get a slow lane each rather than fighting
over one bucket.

### 256 kbit/s, and why that number

Measured in the test rig rather than guessed. At 32 kbytes/second with a 64
kbyte burst, a sustained pull settles at 250 kbit/s, and the burst lets a small
page arrive at full speed before the policer bites.

At that speed a chat message, a search result and a small page all still
arrive. YouTube at its lowest quality wants more; Netflix wants about twice it.
So messaging and reading survive and video cannot hold a stream at any quality.
Gameplay is usually under 150 kbit/s, so a game mostly still plays while
everything it wants to stream in stalls. The asymmetry is the point: the small
things you might genuinely need still work, and the things designed to hold you
for three hours become miserable.

It is settable (`genkan slow-rate`, 32 to 9999 kbit/s) because households and
connections differ. There is a floor because below about 32 kbit/s TCP struggles
to make progress at all, and at that point it is a broken connection rather
than a slow one, which is the failure the whole feature is trying to avoid.

### The cliff or the slope, and why the default did not change

Running out of time can now drop a child into the slow lane instead of cutting
them off. The evening tails off rather than ending mid-sentence, and earning
minutes back puts them straight back to full speed.

It defaults to `cut`, which is what Genkan has always done. Changing what
happens when a child's time runs out is a change to somebody's household
routine, and shipping that as the side effect of an upgrade would be wrong. A
household has to choose the slope: `genkan slow-timeout slow`.

### The child is told, in plain words

A network that is slow on purpose and says nothing about it is just a broken
network. A child who believes the wifi is broken will go and "fix" it: reboot
the router, change their address, borrow a hotspot. That is worse than a block
in every direction, and it is dishonest, which is the part that matters most.

So the portal says it. It names the slow lane, names which categories are in
it, says the number, and says it is deliberate. When it is the out-of-time
slope it says so and points at the ways to earn minutes back. The page itself
is served from the input hook rather than the forward hook, so it always loads
at full speed: the explanation is never the thing that is slow.

### The safety net is never slowed

`@kids_allow` is accepted at the top of the throttle chain, in both directions,
above every policing rule. A child in trouble reaching a help line over a
deliberately crippled connection would be the worst failure this project could
have, so it is proven by a test that throttles the exact category the help line
sits in and then checks it still runs at full speed.

Smart home, appliances and infrastructure are never slowed either. The view the
gateway reads can only return a device filed as `personal`, so a camera or a
smart lock cannot be throttled even if it has somehow been handed to a child.
Same iron rule as the block sets, same guard, in the database rather than in a
script.

### What was deliberately not built

A category that goes over its own budget is still a hard block. Only the
whole-day time budget has the cliff-or-slope choice so far. Doing both would
have meant two settings that look the same and behave differently, and there is
no evidence yet about which one a household actually wants.

## Version numbers are dates, and an upgrade undoes itself (2026-08-30)

An outside review called Genkan "an impressive working prototype rather than a
finished household appliance" and listed what was missing: a reliable
installer, automated upgrades and rollback, a release process, compatibility
documentation. Two of those are the same problem. There was no version number
anywhere, so nobody could say what they were running, and there was no way
back, so an update was a one way door.

That second half is the serious one. This software sits between a household
and the internet. A bad update does not mean a broken app. It means the
children cannot do their homework and the parent cannot fix it, because the
dashboard is down too. Rollback here is not a nice to have.

### Dates, not semantic versioning

`VERSION` holds `2026.09.0`: year, month, patch.

Semantic versioning answers "will this break my code", which is the right
question for a library with programmers downstream. Genkan has none. It is one
repository, deployed one way, on one box, by a family. The question a household
actually asks is "am I running something old", and a date answers that with no
changelog, no comparison and no internet connection. A parent seeing
`Genkan 2025.03.0` in 2026 has learned something. A parent seeing `Genkan 1.4.2`
has learned nothing.

The one change that genuinely breaks an upgrade is a database change, and a
major version bump is far too blunt a way to say so. That gets said per release
instead: `genkan-upgrade check` calls it out before anybody agrees to anything,
and docs/UPGRADING.md says what to do about it.

Rejected: plain dates (no room for a fix inside the same month), build numbers
(meaningless to a parent and to us), codenames (useless down the phone).

The VERSION file names the release being prepared, not the last one shipped, so
between releases a box is running something that is not either. The tooling
says exactly that rather than pretending, because a version number that lies is
worse than no version number.

### The order of operations in an upgrade

Not negotiable, and each step exists because of what it prevents:

1. **Check the new version before switching to it.** The firewall ruleset has
   to parse, the schema has to load into an empty database, every script has to
   be valid shell. All three run against the new code in a throwaway git
   worktree while the live box carries on. A bad release is caught with the
   household still online and never noticing.
2. **Snapshot before changing anything.** A `pg_dump`, the current commit, and
   any uncommitted edits (via tools/worktree-snapshot.sh, which already
   existed for exactly this reason and was reused rather than reinvented).
3. **Apply, then ask the box whether it is working.**
4. **Put the old one back automatically if it is not.**

Step 4 is the point of the whole exercise. A parent at 9pm should not have to
learn what a git commit is.

### The undo tool travels inside the snapshot

`genkan-upgrade` copies `genkan-rollback`, `genkan-health` and the shared
library into the snapshot directory before the switchover, and it is that copy
which runs an automatic rollback. If the new version is broken enough to fail
its health check, its own rollback script is the last thing that should be
trusted to be the fix. This cost four lines and removes an entire class of
"the recovery tool was part of the thing that broke".

### The database is NOT restored automatically

An automatic rollback puts the code back and leaves the database alone.

The temptation was to restore both, because that is the cleaner mental model.
It is also the wrong call. A restore is a restore: everything since the
snapshot goes, and on a household gateway "everything since" means minutes the
children earned, quizzes they passed, chores they claimed. Losing an evening of
a child's earned time to fix a problem that was only ever in the code is its
own harm, and it is a harm the child feels rather than the parent.

So the code goes back on its own, and the database only ever goes back when a
person deliberately asks with `--with-database` and types ROLLBACK in full.
The cost of that choice is honest and documented: a release that drops a
database column cannot be rolled back from with code alone, and the release
notes have to say so. docs/UPGRADING.md carries that limit in the same plain
language as everything else, rather than implying a time machine.

### The health check is read only, and says what it cannot know

`bin/genkan-health` is what the upgrade trusts and what a worried parent runs.
Those two audiences want the same thing: one honest answer. It puts real
questions on the wire (a DNS query and an HTTP request from inside the island's
network namespace, because from the host there is no route to either) rather
than checking that processes exist, since a resolver that is running but not
answering looks identical from the outside to one that is fine.

It writes nothing. That is a rule and not a habit: it is the tool that gets run
when things are already going wrong, and a diagnostic that changes state can
make things worse.

It also says out loud what it cannot tell you: that the broadband is up, that a
child's laptop is on the right wifi, that the filtering caught everything. A
green light that quietly overclaims is how somebody stops trusting the light.

### The proof

test/release-test.sh clones the repo into a temp directory, invents two
releases, points every path at a throwaway, upgrades, breaks the health check
on purpose, and asserts that the tooling put the old version back with nobody
watching. The claim "your internet comes back by itself" is worth nothing
untested, and it cannot be tested on a household's own gateway because the test
is the outage.

## Alerts nobody was looking at (2026-08-30)

Genkan raised alerts and did nothing with them. A device nobody had claimed, a
camera that was not actually restricted, a Tor or self-harm signal: all of them
landed in a table and waited for somebody to open a dashboard. A parent could
learn on Saturday that something concerning happened on Wednesday. Rival
products push to a phone, and the ones that matter here are the safety signals.

**The constraint came first.** Genkan has no telemetry and talks to no cloud,
and notifications are exactly where a product like this starts leaking. So a
route is the household's own box POSTing a message the household worded, to an
address the household typed in, over a route the household can delete. There is
no Genkan server, no account and no opt-out to find, because there is nothing to
opt out of. With no routes, nothing is sent to anybody, and that is what a fresh
install does.

**Two routes properly, not four badly.** ntfy and a webhook ship with tests.
Email and a first-class Home Assistant route are declared in the schema and
**refused by the worker**, with a message saying where the code would go. A
half-built route that accepts a configuration and then never sends anything is
worse than no route, because a parent believes they are covered.

### The wording is the feature

A push notification is read out of context: on a lock screen, in a queue,
possibly in front of the child it is about, possibly in front of somebody
reading over a shoulder. So the rule is that **the notification says something
needs your eyes and where to look, and the detail stays on the dashboard at
home**. The self-harm alert is the one the design is bent around:

> **Genkan: worth a quiet check in**
> One thing today needs your eyes, and it is a care thing, not a trouble thing.
> The detail is on the Genkan dashboard at home. Read it somewhere private.

No child's name, because naming one is an accusation in front of whoever is
standing there. No site, and not even the category, because "self-harm" on a
lock screen tells a passer-by or a sibling something that is the child's to
tell, and freezes a parent in public with nothing they can do. "A care thing,
not a trouble thing", because the first ten seconds of that evening's
conversation are set by the first thing the parent read, and
`docs/tor-and-safety.md` has been clear from the start that the response is a
conversation and never a punishment. And "read it somewhere private", which is
the one instruction that actually matters.

**The wording lives in the database, not in the script.** `notify_wording` has a
row per category with `name_ok` and `detail_ok` columns, both false for every
sensitive category, and a route's `include_detail` can only widen as far as
`detail_ok` already allows. So the rule is enforced by a column rather than by
remembering, a reviewer can read the whole set in one query, and a household can
change the words without editing code. A category nobody has worded yet falls
back to "something needs a look", which names nobody and quotes nothing: a new
alert type is never assumed harmless enough to put on a lock screen.

### The four promises, and where each one actually lives

- **Never twice.** `notify_sent` has `UNIQUE (route_id, alert_id)`. The
  constraint is the mechanism, not the code around it: two overlapping runs
  cannot both send, because the second INSERT loses. A duplicate safety alert at
  2am is how a parent learns to ignore them.
- **One buzz.** Alerts group by category, so twelve unknown devices is one
  message saying "12 devices". Then urgent and warn each keep their own message
  and their own words, and only `info` collapses into a summary, because a
  safety signal buried inside "4 things need a look" is a signal nobody reads.
- **Quiet.** A new route defaults to `warn`, so a chore waiting for approval
  never fires. Quiet hours hold the ordinary; urgent goes through unless a
  household turns that off. A 12 hour horizon retires anything older unsent, so
  a database restore, or a route added on a Saturday, cannot fire a week of
  history at somebody's phone.
- **Never lost.** Rows are written to `notify_sent` only *after* a send
  succeeds, so a route that is down writes nothing and the alert stays
  unacknowledged and goes next time. The worker exits 0 whatever happens.

### Three things the build itself taught us

**A tab is IFS whitespace.** Every other worker in `bin/` reads psql output with
`IFS=$'\t' read`. Bash treats space, tab and newline as IFS whitespace *even when
IFS is set to exactly one of them*, so two adjacent tabs collapse into one and
every column after an empty field shifts left. A route with no token was reading
its rate limits out of the wrong columns and comparing an integer to `f`. The
fix is 0x1f, the ASCII unit separator, which is not IFS whitespace.

**`psql -tAc` prints the rows and the command tag.** A statement with
`RETURNING 1` returns `1` on one line and `INSERT 0 1` on the next, so the
`| grep -c 1` idiom this repo uses in several places reports double what
actually happened. `grep -c '^1$'` is the fix. `bin/genkan-alerts` had the same
idiom and the same overcount; fixed on 2026-08-30, and `test/alerts-test.sh`
now proves one new alert is reported as one.

**Secrets do not belong on a command line.** An ntfy topic name *is* the
password. The sender is Python rather than curl for exactly that reason: the
target and the token arrive in a child process's environment and never in
`argv`, where every user on the box can read them out of `ps`. The sender also
scrubs both out of any error string before returning it, because urllib puts the
whole URL in an exception message and that message ends up in the journal and in
`notify_log`. The dashboard shows a route's host and never its path.

## A check that cannot run must never look like a quiet night

**2026-08-30.** `genkan-alerts` is the path that turns "a child looked up a
self-harm site" into something a parent sees. It stopped working for a day and
nothing said so.

The cause was three lines of prose. A bash comment was written inside a
double-quoted SQL string, and `#` is not a comment inside double quotes, so
every run posted the comment to Postgres, got `syntax error at or near "^"`,
matched no rows, printed `genkan-alerts: nothing new` and exited 0. The unit
that runs it recorded success once a minute for a day. The previous entry in
this file even mentions the script by name, and still nobody noticed, because
the only symptom was the *absence* of alerts and absence is what a good night
looks like.

Three things changed, and the second is the one that matters.

**The comment moved out of the string.** A one-line fix to a one-line mistake.

**A failed query is now loud, and loud in the right place.** The script keeps
its stderr, checks for `ERROR`, and refuses to report calm. It exits non-zero,
but the exit status is not the surface: the unit runs it as `ExecStartPost=-`
so that a broken alert check cannot fail the DNS ingest that feeds it, which
means systemd ignores the status by design. So the failure is raised as an
`alert-check` alert of its own, urgent, where a parent already looks, and the
next good run retires it. This is the same shape as the `dns-ingest` alert, and
the pair of them now cover the whole path: if the log stops arriving, or the
check over it stops running, the dashboard says so.

**A scanner, because the next one will look just as right.** The comment was
legal bash and read perfectly well in an editor. `tools/lint-sql-comments.py`
sweeps every script for a `#` line inside a SQL string and runs as part of
`test/alerts-test.sh`, which also proves a flagged domain still raises exactly
one alert, that the same flag twice in a day raises only one, and that a broken
query raises the alarm rather than reporting nothing new.

The general rule this leaves behind, worth applying to anything else in `bin/`
that reports on the absence of a thing: **a check that cannot run must not be
able to report the same result as a check that ran and found nothing.** Where
those two are indistinguishable, the quiet answer is the dangerous one.

For the record, the household lost nothing. Re-running the check over the whole
outage window found no flagged look-up in it.

## A list nobody applies is not a blocklist

**2026-08-30.** `genkan-tor-sync` fetched the public Tor relay list, wrote 7299
addresses to a file and rendered an `nft -f` snippet, and `kids-tor-sync.service`
piped that snippet into the gateway. Measured on the live box, the `@tor_nodes`
set held zero addresses, so the three reject rules in `kids.nft` that use it
matched nothing and a stock Tor Browser would have connected.

The apply step was not missing. It was skipped, every single time, by its own
guard:

    docker exec hearth-gw nft list set inet kids tor_nodes >/dev/null 2>&1 \
      || { echo "gateway has no tor_nodes set yet, skipping apply"; exit 0; }

The reasoning was sound: a running gateway image might predate the set, and a
fetch that succeeded should not be reported as a failure because of that. What
it missed is *when* this unit runs. `deploy.sh` starts it immediately after
recreating the gateway, which is exactly the two minutes the gateway spends in
its segment-guard wait with no firewall loaded at all. So the guard was
guaranteed to fire, the apply was guaranteed to be skipped, and the unit was
guaranteed to finish green. The journal on this box: three runs, three skips,
zero applies, three lines reading `Finished kids-tor-sync.service`.

A guard that cannot distinguish "too early to apply" from "this will never
apply" is not a guard, it is a way of not noticing.

**The addresses now go into Postgres**, and the gateway rebuilds `@tor_nodes`
from there at startup and hourly, exactly as it does for every other set it
enforces. That is not a new mechanism, it is the mechanism this project already
had and this one list was not using. It is also what makes the fix durable: a
set the gateway rebuilds from the database cannot drift out of force, because a
restart puts it back rather than losing it.

The file and the snippet are kept. The file is the diffable audit trail, and
the snippet is what you apply by hand on a box with no database.

**The second `ExecStart` is gone rather than fixed.** A second writer for one
set, racing the gateway's own reconcile and depending on a readiness check
being right, is worth nothing next to the database the gateway already reads
and already rebuilds from after every restart.

**`genkan-health` was the second half of the problem**, and the more important
half. It reported "the Tor relay list is current" every day, and it was telling
the truth about the only thing it was looking at: the modification time of a
file. It now asks the firewall how many addresses it is holding, and only asks
about the file's age once the answer is more than zero. A check that measures
the input to a system and reports on the output of it is worse than no check,
because it is believed.

`genkan-tor-sync status` gained the same distinction, and prints all three
answers separately: what the file has, what the database has, and what the
firewall is actually enforcing.

## grep -q and pipefail disagree about what success means

**2026-08-30.** Filling `@tor_nodes` with 7299 addresses pushed the ruleset past
64KB, and `genkan-health` immediately began reporting a complete firewall as
incomplete, naming the three device lists the iron rules depend on. Nothing was
wrong with the firewall.

    printf '%s' "$rules" | grep -q "set kids_block {" || missing="$missing $s"

`grep -q` exits the instant it matches. The producer is then still writing into
a pipe with no reader, so it dies of SIGPIPE with status 141, and `set -o
pipefail` promotes that to the status of the whole pipeline. **A successful
match reports failure**, and only once the data outgrows the pipe buffer, which
is why a change to the Tor list appeared to break the firewall check.

The split in the symptom is the tell, and it is worth remembering: `nft list
table` prints the sets first and the chains last, so every set check failed and
every chain check passed. The chain checks were not more correct, they were just
further down the output, giving `printf` time to finish before `grep` matched.

Bash's own matching has no pipe, no second process and no race:

    case "$rules" in *"set $s {"*) ;; *) missing="$missing $s";; esac

`tools/lint-pipefail-grep.py` refuses the pattern anywhere in a script that sets
`pipefail`, and runs inside `test/tor-test.sh`. Four other places had it. One
was `genkan-upgrade`, checking a test suite's output for `FAIL` before allowing
a release through: there, a SIGPIPE would have read as "no failures found" and
waved a broken release through the gate. It had not fired yet only because the
suite's output was still smaller than the buffer.

This is the second bug in one night whose whole damage was a check reporting
calm it had not established. The first was `genkan-alerts`. Both are the same
mistake in different clothes: **the failure of a check must never be able to
look like the success of a check.**

## The DNS log was twelve hours in the past, so no alert ever fired

**2026-09-02.** AdGuard stamps every query log entry in UTC with a Z suffix.
genkan-dnslog cut the string to nineteen characters and inserted it into a
timestamptz column through a session whose TimeZone is the household's, so
13:19:44Z became 13:19:44 New Zealand time: twelve hours early, for every row
since the first one. Nothing looked wrong. The ingest paged correctly,
because it compared against a maximum that was wrong by the same amount. The
week and trends charts looked plausible, because a whole day shifted by half
a day still looks like a day. What did not work was anything that asked "in
the last fifteen minutes": genkan-alerts, which is the only road from a
flagged lookup to a parent's phone, and which has therefore never fired on
real traffic. Its test passed, because the test writes its own rows with
now().

The ingest keeps the offset now, the 66,819 existing rows were shifted
forward twelve hours with the timer paused, and the first real scan ran on
real rows. The rule, again, and this is the third time this file has had to
say it in a week: **a test that fabricates its own input proves the code
path, not the data.** The alert test now needs a case that ingests one real
AdGuard entry through genkan-dnslog and finds it within the window, and
test/alerts-test.sh will get one.

## Allowed by address, filtered by name

**2026-09-02.** Two requests in one evening showed the limit of allowing
things by address: a school site behind Cloudflare (two addresses shared with
thousands of strangers), and "Google search but not Gmail or the messaging
apps" (Google's search front ends are the same machines as YouTube, Gmail,
Meet and Chat). The firewall's `@kids_allow` set is addresses, because
nftables cannot see a name, so allowing the school or the search page by
address alone would have quietly allowed every neighbour on those addresses
to a child whose internet is off.

So a whole-internet cut now has a name layer too. genkan-adguard renders,
for every address in `blocked_device_ips` (the same view the gateway builds
`@kids_block` from), a catch-all rule that answers every name with the
portal's address, and exempts the allow list: `||` for ordinary rows so
wikipedia.org covers en.wikipedia.org, and an anchored regex for
`category='search'` rows so google.com covers google.com and nothing under
it. The packet door stays open (the firewall still cannot tell one name from
another), but walking through it means putting a name in a hosts file, which
no browser does on its own and which this house pays a bounty for. The
proper close, a proxy that reads the server name out of the TLS hello, is on
the roadmap; Cloudflare's encrypted hello would make it a bigger job than it
sounds.

Two smaller things came with it. `genkan-adguard apply` now hashes what it
rendered and skips the write when AdGuard already has it (and checks
AdGuard's live rule count, so a reseeded AdGuard is not fooled by our stale
hash), which is what lets the meter call it every minute so the DNS layer
follows the packet layer within a minute for the whole-house cut and its
clock, not only for commands that remember to call it. And the "search" rows
are exact hosts, added deliberately one by one: the search page, its
country twin, the SafeSearch alias it resolves to for children, and the
static hosts the page pulls from. Not accounts.google.com, which is where a
sign-in would start.

The rule: **allowing by address is allowing the neighbours; a promise about
a name needs a rule that reads the name.** test/adguard-test.sh proves both
sides for a cut device.

## The reading list survives a cut now, not just on paper

**2026-09-02.** Every document said a child who is out of time can still read
Wikipedia: scope='learn' rows in always_allow, "reachable through a total
cut". The firewall said otherwise. `genkan allow-sync` loaded both scopes
into @kids_allow at deploy, but the gateway's own hourly refresh loaded only
scope='safety' and flushed the set first, so the reading list lasted an hour
after each deploy and then vanished for the life of the box. A comment in
bin/genkan named a kids-allow-sync.timer that never existed. Found because a
parent asked for exactly that promise on the night the devices page broke.

The gateway now rebuilds the set from both scopes and says so in its log
line. The portal's ordinary pages no longer carry a help-line footer (the
parent's call: the dinner-time page is not the place for it); the help lines
themselves stay reachable through every cut, and the "come find me" page
that a Tor or drugs flag turns on still shows them, because that page exists
for a child who may need one.

The rule: **a promise about what survives a cut is a claim about a firewall
set, and only `nft list set` can confirm it.** `genkan allow-status` prints
it; checking it should be part of reading the documents that make the claim.

## Two quiet failures the browser and the shell hid

**2026-09-02.** Both found in one sitting, because a MacBook could not get
online and did not appear on the dashboard.

**The device scanner wrote nothing for three days.** On 2026-08-29 a comment
was added inside genkan-devicescan's SQL: `-- ... can never mean "here right
now"`. The SQL sits inside a bash double-quoted string, so the two inner
double quotes closed the string early. psql received CREATE TEMP TABLE and
the COPY; the INSERT and UPDATEs that follow arrived as stray positional
arguments. No error, exit 0, and `saw 11 device(s)` printed every minute
while `devices` sat at 29 Aug 17:12. New devices never appeared, so they
could not be assigned, so they got the portal. It is the same trap as the
`#` comment that killed the alert path (above), from the other side: the
first rule was "bash does not strip a # inside a string"; the second is "a
double quote inside a string ends it". tools/lint-sql-comments.py now refuses
both, the scanner runs psql with ON_ERROR_STOP and fails its unit if the
write fails, and the CSV writer no longer emits carriage returns into the
hostname column.

**The devices page's Assign button did nothing.** dashboard/household.mjs
builds the page's script inside a JavaScript template literal, and the
house-off confirm text was written with `\n` where the literal needed
`\\n`. The served page therefore contained a single-quoted string broken
across real newlines, one syntax error, and every function declared after it
(including `assign`) did not exist. The browser was the only thing that ever
parsed that script. tools/check-pages.sh now fetches every dashboard page and
runs `node --check` over each inline script, which is what the browser does,
and it runs against the demo dashboard so it needs no household.

The rule under both: **a write or a script that fails must fail visibly, and
the check has to run in the place the failure happens.** A count of devices
seen is not a count of devices written; a module that parses is not a page
that runs.

## The warden remembers where the dongle is

**2026-08-31.** Three times in one night the kids' USB NIC was in neither the
host nor the gateway container: a redeploy recreated `genkan-gw`, and the
container suite restarts it on purpose. The AX88179 does not always return to
the default namespace when a container namespace dies, and the warden's
answer to that has always been a USB reset. The reset needs the adapter's
sysfs path, and the warden found that path by MAC once, at start-up, which
only works while the netdev is visible. So a warden restarted at exactly the
wrong moment (a deploy restarts it) started with no path, could not reset,
and the island stayed down until a person did it by hand.

The path is now written to `/var/lib/genkan/kids-nic-usb-path` the first
time it is seen and read back when discovery fails. The reset also goes to
the device (`2-6.2`), not the interface (`2-6.2:1.0`): de-authorising only
the interface was tried and left the netdev missing, while the device reset
brought it straight back. The rule underneath: **anything the recovery path
needs must be known before the failure, not discovered during it.**

A related one for the runbooks: `genkan-portal` and `genkan-speedtest` share
the gateway's network namespace and are not restarted with it, so after a
gateway restart they point at a dead namespace and the health check says the
children's page is not answering. The warden already restarts AdGuard for
exactly that reason. Restart those two as well, or restart the stack.

## The product is called Genkan

**2026-08-31.** Hearth was a working title, and it was crowded: half a dozen
software projects already wear the name. The product is now **Genkan** (玄関),
the recessed entryway of a Japanese house where street shoes come off before
anyone stands on the floor of the home. From Middle Chinese 玄關, "the hidden
gate": 玄 dark, hidden, profound; 関 barrier, checkpoint. A boundary made of
hospitality rather than defence, which is precisely the register this product
aims for, and a word that has meant "the gate where the outside stops" for a
thousand years.

Capitalised "Genkan" in prose, lowercase `genkan` as the command, the package
and the domain. The site is **genkan.nz**, the repo is
github.com/0800tim/genkan, and the CLI is `bin/genkan` with `kidnet` kept as a
compatibility shim.

The technical names followed the same night, as one deliberate job rather
than a side effect of the documentation sweep: the containers are
`genkan-gw`/`genkan-adguard`/`genkan-portal`/`genkan-speedtest`, the
environment variables are `GENKAN_*`, the working-tree snapshots live at
`refs/genkan/snapshots`, state is under `/var/lib/genkan`, the host-side
units are `genkan-*`, and the demo stack is `genkan-demo`. deploy.sh carries
the one-time migration for a household that deployed under the old names
(config.env keys, the state directory, AdGuard's volumes, the old containers)
and does nothing on a box that never had them. Two things keep the old name
on purpose. The old public hostnames (`hearth.appspurt.dev` and the two demo
hostnames) still resolve and redirect, because they are printed in a pitch
document and a few posts. And `research/` keeps the old name throughout:
those files are dated snapshots, one of them records the naming exploration
itself, and editing history to agree with a decision made later would falsify
the record.

## Content lives in a registry, not in the product (2026-09-02)

The ask, once the shelf held a worked example and the curriculum passed forty
banks: modules are going to arrive all the time, hopefully without every one
needing a contributor to the product. Should they all be in the repo and
pulled from there, or in a central database? The wider hope was a plug-in
space in the manner of Omarchy's marketplace or Shopify's apps, where somebody
writes a woodworking module or a model boat module, families download it, and
a community of learning children grows around it.

**Decision: a public, git-backed registry of signed static files. Not the
product repo, and not a database we run.** The design is `docs/COMMUNITY.md`;
this entry is the why.

### Why not the product repo

Two reasons already recorded in "Anyone should be able to teach something"
and they still hold: `portal/quizzes/` is tracked in git, so a `git pull`
deletes or overwrites a family's content, and content tied to the repo is
tied to releases. A dated release train is the right cadence for a firewall
and the wrong one for a fix to a single wrong answer. There is a third: a
repo holding thousands of questions makes every clone heavier for the parent
who wanted the gateway, and makes content review and firewall review the
same queue, read by the same people, when they are not the same people.

### Why not a central live database

It was the obvious answer and it is the one thing this project cannot build.
A database that every house queries sees which house asked for what and when.
It goes down when we do. It is where an account eventually appears "to make
things easier". `PRIVACY-CHARTER.md` P1 and P2 both forbid it, and the honest
answer to "how do I know you are not watching my kids" (read the code, it
never sends anything) stops being available the moment it exists. The
registry had to be something a household could clone with git and carry into
the house on a USB stick, and something that keeps working if genkan.nz is
gone. Static files, mirrored into the index repo, are that.

### What was decided about the shape

- The product repo keeps a **starter set** so a fresh install teaches
  something on day one with no network: the banks, the reading list, the
  default tiers. Those same items become the registry's first entries, which
  is also the answer to the empty-category problem.
- The **house database holds only what is installed.** Installing is a
  database write through a narrow `SECURITY DEFINER` function per kind, the
  pattern `install_quiz_package()` set. A package is JSON, never executes,
  and removal deletes exactly the rows tagged with its id.
- **Five kinds**, one file each: quiz banks (built), reading-list rules,
  filter rule sets and tier presets, bedtime presets, and project modules
  with steps, materials, evidence a parent confirms, an earn value and a
  badge. Every kind is validated as hostile input with the rules the quiz
  validator already applies, and every kind has a line it cannot cross: a
  package can never touch a `scope='safety'` row, never set `force_dns`
  false, never change who may lift a block, and never carry a link off the
  reading list.
- **Trust is a mechanism, not us.** Pinned hashes in the index, a registry
  signature that means "passed CI and was merged", an optional author
  signature, and a review flag that is a named person saying they read every
  answer. The registry public key ships in the product repo so the first
  fetch is verified against something the box already had.
- **The fetch is a charter change.** P1 lists one outbound request today
  (the Tor relay list). A registry fetch is a second, the same shape
  (download a public file, upload nothing), from the host and never the
  island, only when a parent types the command, and it has to be written
  into P1 in the same pull request that adds it. No counts, no beacon, no
  timer. If the community ever wants install counts, that is opt-in, off,
  identifier-free, a second charter change, and this entry recommends
  against it.
- **The dashboard stays read-only for packages.** The earlier decision that a
  stranger's writing goes in front of a child by a deliberate act at a
  terminal stands. An install button for reviewed packages is a fair ask and
  is recorded as an open question, not quietly built.

### What was deliberately not decided

Whether the forty banks should eventually leave the product repo entirely
and be pinned from the registry instead; whether tier and bedtime presets
belong in the same registry as learning content or in a separate, smaller
one with a higher review bar; and whether `checked` needs more than one name
on it before a package about a country's curriculum gets the flag. Each
needs a real registry running before the answer is worth anything.

Nothing in this entry is built beyond the quiz package. `docs/COMMUNITY.md`
ends with the table that says so.

## Analytics and logs: the whole log, and every number says what it is

**2026-09-02.** The parent asked for "an analytics page where we can see all
traffic and graphs and what's been viewed", to "go deep into the logs", and to
see time on gaming, TikTok, Instagram and the like, and "attempted porn
sites". The dashboard already had the pieces (Trends, Week, the kid page) but
no way to start from a chart and end at one row. The new page
(dashboard/analytics-page.mjs, /analytics) is that road: lookups over time
per hour or per day stacked by person, blocked lookups by reason, the top
sites per person, the meter's minutes per category, a "worth a look" strip,
and under it the log itself, filterable by person, device, category, allowed
or blocked, reason, site and free text, newest first, with older rows
fetched from /api/analytics without a reload. Click a child, then a site, and
every lookup of it is on the screen.

What it refuses to claim, and why, because "what's been viewed" is not
something a DNS server knows:

- **A lookup is a lookup.** It means a device asked for a name. It is not a
  minute, not a byte, not a page view and not proof a person looked at
  anything: apps ask for names in the background all day, and one embedded
  advert can ask for an adult domain more times than a child ever would. The
  charts and the tiles say "lookups", and the count chart is a new primitive
  (countColumns in charts.mjs) rather than the minutes chart with a different
  title, so no tick or tooltip can ever say "min" over a count.
- **The only minutes are the meter's.** The minutes-per-category chart reads
  category_usage, the same figures as Trends, and says so. On a box where the
  meter has not run it says there are none, and does not offer lookups as a
  stand-in.
- **"Blocked" means unanswered.** Nothing about what would have loaded.
- **The reason is AdGuard's word, stored, not inferred.** dns_log only held
  allowed or blocked, so an advert, an adult site, a child's TikTok being
  switched off and a child sent to the portal because their time ran out were
  indistinguishable. genkan-dnslog now stores AdGuard's `reason` and, for a
  blocklist hit, the name of the list that matched (`filter_list`, read once
  per run from AdGuard's filter status, so the page never has to ask AdGuard
  anything live). "Adult" on the page means the OISD NSFW list matched;
  "gambling" means HaGeZi Gambling did. A household that renamed its lists
  gets "blocked by a blocklist", which is the direction to fail in. Rows from
  before the columns existed show as "reason not recorded" rather than being
  guessed at from the domain.
- **Safe search is not a block.** AdGuard reports a FilteredSafeSearch rewrite
  as filtered, and genkan-dnslog has always stored that as blocked. The page
  labels it "safe search enforced (the site still worked)" rather than
  changing what `action` means under the alerts and the Trends counts.
- **Unattributed stays visible.** Lookups from a device nobody has named are a
  grey band on the chart and a section of their own, never dropped and never
  spread across the children.
- **A VPN, Cloudflare WARP, a browser's own DNS-over-HTTPS or mobile data make
  all of it blind**, and the page says so in the same words as
  docs/tor-and-safety.md. It shows the bypass names Genkan blocked, which is
  the honest extent of what it can do.

Two smaller things came with it. test/alerts-test.sh now feeds one entry
shaped exactly like AdGuard's (UTC, Z suffix, nanoseconds) through
genkan-dnslog itself, from a stand-in AdGuard on a local port, and checks the
stored row is stamped now, with the reason and list kept: the twelve-hour bug
above was invisible to a test that wrote its own rows. And the demo seed's
DNS history was found to be sixteen thousand lookups of one domain from one
tablet, because a lateral subquery that does not reference the outer row is
evaluated once; every pick now does, and the demo shows four weeks with an
evening shape and a few blocked adult and gambling names on a reserved test
domain, because a public seed file is not the place to type real ones.

The rule: **a page that shows a parent "what was viewed" must say, on the
page, that it cannot see that, and must store the reason rather than infer
it.**

## The filter levels are data, and the allow list grows but never narrows

**2026-09-02.** The parent asked for a page "where we can configure what a
young child is versus standard versus teen and what they can and can't do",
and to add sites to the allow list. Three decisions came out of building it.

**A level is a row, and the database wins.** What `young` meant on the DNS
side (parental control, SafeSearch, twelve blocked services) was a Python dict
inside `bin/genkan-adguard-clients`, and that script deliberately never
re-templated an existing AdGuard client, so that a parent who had tuned one
in the AdGuard UI kept the tuning. That was defensible while the levels were
hard-coded and had a quiet cost: moving a child from `young` to `teen` on the
Family page changed their minutes and nothing about their filter, because the
client they already had was never touched. The AdGuard half of each level now
sits on `policies` beside the minutes (`config/db/schema-settings.sql`, filled
once with exactly the dict's values so an upgrade changes nobody's filter),
`genkan tier set` is the one write path, and `genkan-adguard-clients` brings a
drifted client back to its level on every run, the same way the gateway
rebuilds its sets from the database rather than trusting what it finds. Tune
a level on the Settings page, not in the AdGuard UI, where it will not last.
First live run found the `safesearch` column, which nothing had enforced,
disagreeing with the dict for the guest level; the schema sets the column to
what was enforced, once, in the same guarded moment it fills the new columns.
The global blocklists stay global, and the page says why: AdGuard applies a
filter list to every client or to none.

**The allow list can be grown by a parent and narrowed by nobody.** Three
promises live in `always_allow` and the page shows them apart: the safety net
(help lines and schoolwork, `scope='safety'`), the reading list (`learn`,
suffix match), and the search hosts (`category='search'`, exact match, per
"Allowed by address, filtered by name" above). A parent adds to the second and
third through `genkan allow add`, which stamps `added_by='parent'`, and takes
back only what a parent added: a shipped row deleted by hand would return on
the next schema reload, so refusing with that reason is more honest than a
removal that lasts until the next upgrade. The safety rows are refused by a
trigger in the database, `always_allow_keep_safety`, which refuses DELETE and
any UPDATE that narrows the scope, for every role including the superuser.
`kids_agent` was granted DELETE on the table for the reading list, and the
trigger is what keeps that grant from ever reaching 1737. Both are proved in
`test/db-role-test.sh`. The page also says, next to the Add button, what
adding a domain means: the firewall allows by address, and addresses are
shared, so the neighbours come too; only the name layer is exact.

**The switches that are off stay off.** Device claiming, the household IoT
policy's enforcement and the house board each get a control on the page with
the honest sentence beside it, and their defaults are untouched: `off`,
`observe` with the timer left disabled, and `false`. Anything that lives in a
file rather than the database (the portal's flag window, the timezone, the
whole-house cut's length) is shown read-only with where it lives, rather than
given a box that would save nothing. The card at the bottom, "What this page
cannot do", is there for the same reason every limits section in this repo is:
a settings page that implies a per-device blocklist, an HTTPS portal or sight
through a VPN would be lying, and the credibility of the rest rests on not
lying there.
