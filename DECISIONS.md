# How Hearth got here: the decision log

The reasoning behind the design, captured so the "why" isn't lost. Written
2026-08-27/28 from the conversation that built the project.

## The original ask

Tim: kids (11, 14, 16) won't get off their devices. Wants to control their
internet over WiFi, turn devices on/off, ideally by TALKING to the assistant
from his phone ("turn off Ben's internet", "kill kids wifi"). Also wants to
kill his son's Android MOBILE DATA.

## First reality checks

1. **Clawdia is a LAN host, not the router.** The gateway is an ASUS at
   192.168.1.1 (SSH off). A host can't cleanly cut another device's traffic
   without controlling the router or ugly ARP tricks. So we needed clawdia to
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
- **CHOSEN: clawdia as the kids' gateway** via a spare USB-ethernet adapter.
  Zero new OS, always-on, fully agent-controlled, ~$0. This is essentially
  "OPNsense-style control" but on the Linux box we already own.

## The topology we settled on

    ASUS (192.168.1.1) -> clawdia enp5s0 (uplink, unchanged)
                           clawdia kids0 (USB ASIX AX88179) = 192.168.60.1 gateway
                              -> spare switch
                                   -> son's wired PC
                                   -> TP-Link Deco X20 (AP MODE) -> kids' + guest WiFi

- USB NIC detected: ASIX AX88179 = kids0 (mac in config.env, gitignored).
- Deco X20 is APP-ONLY (no web UI / SSH / API). We don't need to control it:
  Tim flips it to Access Point mode ONCE via the app, then it's a dumb bridge
  and clawdia owns everything. Must NOT stay in router mode (it would NAT and
  hide devices behind one IP, defeating per-device control).
- Confirmed cabling (Tim, for his house layout): kids0 -> Deco port 1;
  Deco port 2 -> switch -> wired devices.
- DHCP: clawdia is the single DHCP+DNS server. Deco in AP mode runs neither.
- Guests join the SAME isolated island (internet yes; main network no).

## Security decisions

- **Segment isolation**: the kids/guest island cannot reach the main
  192.168.1.0/24 LAN where clawdia and all client work live. Guests get
  internet, nothing else. (nftables forward drop to RFC1918 internals.)
- **DNS forcing**: redirect all :53 to clawdia, block DoT (853), filter DoH,
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
- **The trick**: clawdia is the DNS server, so it knows which IPs belong to
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
- NOT pushed to GitHub yet, Tim is holding off publicising. gh is authed as
  0800tim when he's ready. A rendered public pitch would need GitHub Pages
  (a raw .html GitHub link shows source, not the page).

## Status at handover

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
   address (without that, `tcp dport 80 accept` matched every address clawdia
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
three-namespace lab (kid, clawdia, internet), loads the ruleset that ships, and
asserts the guarantees with real packets. Twenty checks, no hardware needed.
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
