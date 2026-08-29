# CLI reference

Every command Hearth ships, what it takes, and what it actually does. Written
from the scripts themselves, so if this file and a script disagree, the script
is right and this file is a bug.

There are sixteen executables in `bin/`. One of them, `kidnet`, is the control
surface a parent or an agent drives by hand. The rest are background workers
that timers run, plus `kidnet-report` and `kidnet-quiz`, which you run when you
want to read something or to change what the kids can learn from.

`deploy.sh` installs fourteen of them into `/usr/local/bin`. `kidnet-report` and
`kidnet-quiz` are not among them: run those from the repo
(`bin/kidnet-report`, `bin/kidnet-quiz`), because they read files that live
there.

| Command | Run by | What it is for |
|---|---|---|
| [`kidnet`](#kidnet) | you, or your agent | the control surface: on, off, categories, time, devices |
| [`kidnet-report`](#kidnet-report) | you, weekly | the family digest, read only |
| [`kidnet-quiz`](#kidnet-quiz) | you, or your agent | manage the learn-to-earn quiz banks |
| [`kidnet-meter`](#kidnet-meter) | `kids-meter.timer` | ticks a minute off each active child's daily budget |
| [`kidnet-catmap`](#kidnet-catmap) | `kids-metering.timer` | learns which addresses are gaming, video or a download |
| [`kidnet-catmeter`](#kidnet-catmeter) | `kids-metering.timer` | counts active category minutes, enforces category budgets |
| [`kidnet-servicemap`](#kidnet-servicemap) | `kids-services.timer` | learns which addresses are YouTube, Netflix, Roblox and so on |
| [`kidnet-servicemeter`](#kidnet-servicemeter) | `kids-services.timer` | counts real bytes per service per device |
| [`kidnet-devicescan`](#kidnet-devicescan) | `kids-devicescan.timer` | pulls DHCP leases into the devices table |
| [`kidnet-classify`](#kidnet-classify) | `kidnet-devicescan` | guesses personal, IoT or infrastructure for each device |
| [`kidnet-dnslog`](#kidnet-dnslog) | `kids-dnslog.timer` | pulls AdGuard's query log into `dns_log` |
| [`kidnet-alerts`](#kidnet-alerts) | `kids-dnslog.service` | raises alerts on flagged domains just ingested |
| [`kidnet-adguard`](#kidnet-adguard) | `kidnet`, on every change | renders category blocks into AdGuard's rule list |
| [`kidnet-adguard-clients`](#kidnet-adguard-clients) | `kidnet assign` | points each child's AdGuard client at their real device IPs |
| [`kidnet-tor-sync`](#kidnet-tor-sync) | `kids-tor-sync.timer` | fetches the public Tor relay list for the firewall |
| [`kidnet-iot-policy`](#kidnet-iot-policy) | `kids-iot-policy.timer` (installed, off by default) | generates the household IoT security policy from the database |

Everything talks to Postgres through `docker exec -i postgres psql`, so the
tools need the `postgres` container running and the Docker socket readable.
The tools that talk to AdGuard need `ADGUARD_PASS` in the environment, which
is why the timer units all carry `EnvironmentFile=.../secrets.env`.

---

## kidnet

The one command a parent or an agent uses. Run it with no arguments to print
this same summary from the script's own header.

State lives in Postgres. `kidnet` writes the desired state, then pushes it to
the two enforcement planes: nftables (via `docker exec hearth-gw nft`) for the
coarse internet switch, and AdGuard (via `kidnet-adguard`) for per-category DNS
blocks. If the firewall is not loaded yet, `kidnet` says so and still records
the state, and the gateway picks it up when it comes back.

### Who you can name

Most commands take a person's name. They also accept a group:

- `kids` every child under this roof **and** every visiting child
- `guests` every visitor, child and grown-up
- `guest-kids` visiting children only
- `guest-adults` visiting adults only
- `adults` every grown-up, household and visiting
- `household` everyone who lives here, no visitors
- `all` everyone except the adults, plus any personal device nobody has claimed
  yet. This is what `dinner` and bedtime use.
- `everyone` literally every personal device, adults included

`all` is deliberately not `everyone`: a control aimed at the kids must never
reach a visiting grandparent, but it must still catch a tablet nobody has named
yet. A guest who has been marked gone home is in no group at all.

Which group somebody falls in is decided by their role (`child`, `guest-child`,
`guest-adult`, `adult`), and the answer lives in the database, in
`people_in_scope()`. See [HOUSEHOLD-ROLES.md](HOUSEHOLD-ROLES.md).

**Groups only ever touch devices classified `personal`.** Cameras, locks,
speakers and other IoT are never cut by `kidnet off all` or by `dinner`. See
[device classification](#kidnet-classify).

### Internet on and off

    kidnet off <person|group>
    kidnet on  <person|group>

Adds or removes that person's reserved addresses in the nftables `kids_block`
set and records it in `category_state`. A blocked device keeps DHCP, DNS, the
captive portal and the safety net: it does not fall off the network, it lands
on the "time's up" page.

    kidnet dinner        # kidnet off all, with a nicer message
    kidnet resume        # kidnet on all

### Categories

    kidnet game  off|on <kid>     gaming: Roblox, Fortnite, Steam, consoles
    kidnet media off|on <kid>     video + social; Spotify and audio stay up
    kidnet study on|off <kid>     gaming + video + social off together

All three write `category_state` and then call `kidnet-adguard apply`, which
answers that category's domains with the portal address for that child only.
`study on` is exactly `game off` plus `media off`; `study off` clears all three.

### Time

    kidnet time    [kid]                    minutes left today, or everybody
    kidnet bonus   <kid> <min> [why]        grant general minutes, reopens the internet
    kidnet grant   <kid> <gaming|video> <min>   grant minutes to ONE category
    kidnet earn    <kid> <task|min>         credit a named task's minutes, or a raw number
    kidnet penalty <kid> <min> [why]        dock minutes
    kidnet spend   <kid> <min>              consume minutes; blocks the internet at zero

`bonus`, `earn` and `penalty` all write `time_ledger.bonus_min` and an audit row
in `time_events`. `bonus` and `earn` turn the internet back on if the child now
has minutes left.

`grant` is the per-category equivalent: it raises `category_budgets.daily_min`
for gaming or video by that many minutes and clears an over-budget block for
that category. It will not clear a block a parent set, only one the meter set
(`set_by='over-budget'`). Any other category name is refused.

`earn <kid> <task>` looks the task up in the `tasks` table with a fuzzy `ILIKE`
match and uses its minutes. If nothing matches, the argument is treated as a
number of minutes.

A child on the teen tier has no daily budget. That is stored as 999 in
`time_ledger`, which the meter treats as unlimited, and `kidnet time` prints
"no daily limit (teen tier)".

`kidnet time` with no name reports the whole house: one line per active child
and guest child, in name order. It used to die with a raw bash parameter error,
which reached the dashboard verbatim.

### The safety net

    kidnet allow-sync      resolve scope='safety' domains into the nft kids_allow set
    kidnet allow-status    print what is currently in that set

`allow-sync` resolves each `always_allow` row with `scope='safety'` (the NZ
youth help lines and schoolwork) with `getent`, and loads the addresses into
`@kids_allow`. It refuses to install an empty result: a resolver blip leaves the
old list in place rather than leaving a child unable to reach 1737.

You rarely need to run this. The gateway container does the same sync at start
and once an hour on its own.

### Household devices

    kidnet iot status                    what the policy is, and what it has refused
    kidnet iot show <device>             the effective policy for one device
    kidnet iot learn                     refresh the vendor address lists, then apply
    kidnet iot apply                     regenerate the firewall from the policy rows
    kidnet iot set <device> <field> <value>
    kidnet iot allow <phone> <device>    let one device reach another
    kidnet iot mode off|observe|enforce

A pass-through to [`kidnet-iot-policy`](#kidnet-iot-policy), so there is one
control surface. This is the household layer, not the kid layer: what each
camera, lock, speaker and vacuum is allowed to talk to. Read
[HOUSEHOLD-SECURITY.md](HOUSEHOLD-SECURITY.md) before switching it on.

### Devices and people

    kidnet devices                      the full roster, with owner and online state
    kidnet unassigned                   devices nobody has claimed yet
    kidnet leases                       current DHCP leases
    kidnet assign <mac|ip> <person> <label> [reserved-ip]
    kidnet infra <mac>                  mark a device as infrastructure (an AP, a switch)
    kidnet person add <name> <child|guest-child|guest-adult|adult> [tier]
    kidnet person list                  who is in the house, by role
    kidnet guest leave <name>           they have gone home
    kidnet guest back <name>            they are visiting again
    kidnet guest list                   the visitors here right now

`assign` maps a device to a person, then immediately runs
`kidnet-adguard-clients` so the age tier follows the device rather than lagging
a minute behind. Pass a MAC (anything containing a colon) or an address. The
optional fifth argument sets the DHCP reservation at the same time.

`person add` defaults the filter level from the role: `guest-adult` gets the
guest level, `adult` gets the adult level, and a child or a visiting child gets
standard. A bare `guest` is read as `guest-child`, because that is the only
thing it used to mean and because the safer mistake is to filter a grown-up too
tightly rather than to leave a child unfiltered.

`guest leave` does four things in an order that matters: it lifts anything
blocked for them first (so no address is left cut off in the firewall), lets
their devices go, clears their category blocks, and marks them inactive so they
fall out of every group. Their row is kept, so `guest back` is one command.
See [HOUSEHOLD-ROLES.md](HOUSEHOLD-ROLES.md).

### Looking around

    kidnet status              which categories are blocked, per child
    kidnet recent <kid> [n]    that child's last N domains (default 25, last 24 hours)
    kidnet topsites [n]        busiest allowed domains today across all children (default 15)

### Input validation

Everything a person types is gated before it reaches SQL, because the dashboard
feeds this script over HTTP and the household bug bounty invites the kids to
attack it:

- names: `[A-Za-z0-9_-]`, 1 to 32 characters. Group controls work by database
  id rather than by name, so a household that already holds an awkwardly named
  person can still use `kidnet off kids`; only addressing that person
  individually is refused.
- numbers: digits only, at most 4
- free text (reasons, labels): letters, digits and `_ : + . , -` and spaces, at
  most 80 characters

### Environment

| Variable | Default | Effect |
|---|---|---|
| `GW_CONTAINER` | `hearth-gw` | which container holds the island's namespace |
| `NFT_DIRECT` | unset | set to `1` to run `nft` on the host instead (the no-Docker variant) |
| `NFT` | `/usr/sbin/nft` | the `nft` binary, when `NFT_DIRECT=1` |
| `ADGUARD_PASS` | unset | without it, the DNS layer is skipped silently and the database stays the source of truth |

---

## kidnet-report

    bin/kidnet-report <child> [week]
    bin/kidnet-report all [week]

The weekly family digest: time online, metered categories, top sites, things
worth a chat, and what was earned. One block per child, plain text, Monday to
Sunday.

`[week]` is blank for the current week so far, `last` for the previous full
week (what you want for a Monday morning digest), or a `YYYY-MM-DD` date to get
the week containing that date.

Strictly read only: the script contains nothing but SELECTs. Full description
and how to schedule it: [reporting.md](reporting.md).

---

## kidnet-meter

No arguments. Run every minute by `kids-meter.timer`.

Finds every child who has a device seen in the last two minutes, is not already
internet-blocked, and has a real daily budget (teen tier, stored as 999, is
skipped), then calls `kidnet spend <kid> 1`. At zero, `kidnet` blocks their
internet and marks the block `set_by='out-of-time'`, which is the only kind of
block a quiz can lift.

This is the whole-internet minute meter. Per-category minutes are counted
separately by `kidnet-catmeter`.

---

## kidnet-catmap

No arguments. Run every minute by `kids-metering.timer`, just before
`kidnet-catmeter`.

Reads AdGuard's query log, matches each looked-up name against
`category_domains` by longest domain suffix, and records the A-record answers
in `category_ips` as "these addresses are gaming", "video" or "download". That
is the trick that lets the firewall meter encrypted traffic without decrypting
anything: see [../METERING.md](../METERING.md).

Two guards decide whether an address is trustworthy enough to meter:

* **The ambiguity guard.** An address is tagged only if, across the window just
  scanned, it answered for exactly one category and for no uncategorised name.
  A shared front door (a bare `googlevideo.com` lookup returns a general Google
  edge address that also serves search and the Play Store) is dropped, and
  deleted from `category_ips` if an earlier run had tagged it. Tagging those
  was what made every byte a phone sent to Google look like YouTube.
* **Routable answers only.** A blocked query is answered with `0.0.0.0` and a
  rewritten one with the portal's address. Neither is a destination anyone
  sends bytes to, so neither is ever learned.

The honest cost: a dedicated CDN host that happens to appear once beside an
uncategorised name is dropped too, so a category can be under-counted. That is
a much smaller lie than colouring the whole house's traffic with it.

| Variable | Default | Effect |
|---|---|---|
| `CATMAP_PAGES` | `15` | how many 100-entry query-log pages to walk per run |
| `ADGUARD_URL` | `http://127.0.0.1:8853` | AdGuard's API, published to the host's loopback |
| `ADGUARD_USER` | `admin` | |
| `ADGUARD_PASS` | required | |

---

## kidnet-catmeter

No arguments. Run every minute by `kids-metering.timer`, straight after
`kidnet-catmap`.

Three steps each minute:

1. Reconcile the `gaming_ips`, `video_ips` and `download_ips` nft sets to
   exactly what `category_ips` holds from the last 24 hours. Flush and refill
   in one transaction, not add-only: an address withdrawn by the mapper's
   ambiguity guard has to leave the firewall too, or it keeps mis-colouring
   every byte sent to it until the container is restarted.
2. Read and then flush the per-device counters `gaming_dev`, `video_dev` and
   `download_dev`, so each read is that minute's delta. A device over the
   threshold earns one active minute for its owner in `category_usage`. Under
   the threshold is idle keepalive and counts for nothing.
3. Compare `category_usage` against `category_budgets`. A child at or over
   their budget gets that category blocked with `set_by='over-budget'`, and the
   block is pushed to AdGuard.

**Downloads are not screen time.** A game update is bandwidth, and charging it
to a child's gaming budget would be a lie. Two things separate a download from
playing, and both are needed:

* **Destination.** The content-delivery names (`steamcontent.com`,
  `cs.steampowered.com`, the PSN, Xbox and Nintendo asset CDNs, OS and app
  store updates) are their own `download` category in `category_domains`, and
  are longer suffixes than the gaming domains they sit under, so they win.
* **Rate.** Anything above `DOWNLOAD_BYTES_PER_MIN` to a *gaming* address in
  one minute is booked as a download instead, which catches the CDN names
  nobody has listed yet. Deliberately not applied to video, where 4K streaming
  is legitimately fast.

Download minutes are recorded so the live chart can show them, but the category
is excluded from budget enforcement, so it can never cut a child off.

Audio, schoolwork, chess and messaging are not in any metered set, so they are
never counted and never blocked by this.

If `download_ips` is missing (an island still running an older ruleset) the
script creates the two sets and the one counting rule itself, so the new
category starts working on the next tick instead of needing the gateway
container restarted. It only ever adds what is genuinely absent, so it cannot
stack a duplicate rule.

| Variable | Default | Effect |
|---|---|---|
| `GAMING_THRESH` | `51200` | bytes in a minute that count as actively gaming |
| `VIDEO_THRESH` | `256000` | bytes in a minute that count as actively watching |
| `DOWNLOAD_THRESH` | `256000` | bytes in a minute that count as actively downloading |
| `DOWNLOAD_BYTES_PER_MIN` | `52428800` | above this on a gaming address it is an update, not a game (~7 Mbit/s) |
| `KIDS_IFACE` | `kids0` | island interface, used only when adding the download rule to an older ruleset |
| `GW_CONTAINER` | `hearth-gw` | |
| `NFT_NS` | unset | run `nft` in this network namespace instead (used by the tests) |
| `NFT_DIRECT` | unset | `1` to run `nft` on the host |

Exits quietly with a note if the firewall is not loaded.

---

## kidnet-servicemap

No arguments. Run every minute by `kids-services.timer`, just before
`kidnet-servicemeter`.

The same DNS trick as `kidnet-catmap`, one level finer. Matches query-log names
against `service_domains` (YouTube, Netflix, Disney+, Prime Video, TikTok,
Twitch, Instagram, Snapchat, Roblox, Fortnite, Steam, Minecraft, Spotify, Khan
Academy, Google Classroom) and records the answers in `service_ips`. Longest
suffix wins, so `nflxvideo.net` beats a bare guess at `netflix.com`.

| Variable | Default |
|---|---|
| `SERVICEMAP_PAGES` | `15` |
| `ADGUARD_URL` / `ADGUARD_USER` / `ADGUARD_PASS` | as above |

---

## kidnet-servicemeter

No arguments. Run every minute by `kids-services.timer`.

Generates its own nftables sets and a counting chain from the `services` table,
so adding a service is a database row rather than a firewall edit. Per metered
service it maintains `svc_<name>_ips` (addresses learned from DNS) and
`svc_<name>_dev` (a dynamic per-device byte counter). The chain hooks forward at
priority 20 and its policy is accept: **it only counts, it never accepts or
drops, so it cannot change any verdict.**

Each minute it refreshes the address sets, reads and flushes the counters, and
adds the delta to `service_usage` (bytes always, plus one active minute if the
device moved more than the threshold). That is what makes "how much Netflix this
week" a measurement rather than a guess.

| Variable | Default | Effect |
|---|---|---|
| `SERVICE_ACTIVE_BYTES` | `51200` | bytes in a minute that count as active use |
| `GW_CONTAINER` / `NFT_NS` / `NFT_DIRECT` | as for catmeter | |

Honest limits, which the dashboard states too: services on a shared CDN blur
together, YouTube Music counts as YouTube, an address serving several services
attributes to whichever resolved it most recently for that device, and a VPN
hides destinations entirely.

---

## kidnet-devicescan

No arguments. Run every minute by `kids-devicescan.timer`.

Reads AdGuard's DHCP status (both dynamic and static leases) and upserts a row
per MAC into `devices`, owned by nobody until a parent assigns it. Refreshes
`last_seen` and `dhcp_leases`, which is what `kidnet leases` prints. Then it
records presence, then it runs `kidnet-classify` on anything new.

**"Seen before" and "here now" are different columns.** `last_seen` comes from
the lease list, and a lease outlives the device that holds it by up to its full
duration, so it can never mean "on the wire right now". Presence is read
separately from the gateway's neighbour table (`ip neigh show dev kids0`, states
REACHABLE, STALE, DELAY and PROBE), and written to `devices.present_at`. A
device is in that table only if it has answered ARP recently. That is what the
dashboard's green dot reads: before this, a phone that left the house in the
morning showed as online for the rest of its lease.

`DISTINCT ON` on both upserts is load bearing rather than tidiness. One device
can hold more than one lease (a renewal onto a new address, or a static entry
beside a dynamic one), and Postgres cannot apply `ON CONFLICT` to the same row
twice within one statement. A duplicate used to abort the whole scan.

It logs devices, not people. Assigning a device to a person is deliberately a
manual step: only the parent knows whose phone is whose.

| Variable | Default | Effect |
|---|---|---|
| `GW_CONTAINER` | `hearth-gw` | the container whose neighbour table is read for presence |

---

## kidnet-classify

No arguments. Normally run by `kidnet-devicescan`; safe to run by hand.

Every device sits in one of four classes, which decides how it is treated:

| Class | What it is | How Hearth treats it |
|---|---|---|
| `personal` | a phone, tablet, laptop, console, TV | assignable to a person, filtered and metered by their tier |
| `iot` | cameras, locks, speakers, vacuums, lights, plugs, thermostats, appliances | never assigned, never metered, **never cut** by `kidnet off all` or `dinner` |
| `appliance` | an SMS gateway, a build agent, a media server: nobody's device, but not smart-home kit either | full internet, no owner, no time limits, never caught by a kids control |
| `infra` | the access point, switches, the gateway itself | not a client at all |

The `iot` row is the one worth saying out loud: your smart lock, your doorbell
and your security camera stay online when you pause the kids at bedtime,
because the group commands only ever touch `personal` devices. Nobody's front
door goes offline because a fourteen year old ran out of time.

`appliance` (`config/db/schema-appliance.sql`) is a parent's decision, made in
the owner picker on the dashboard's Devices page. The classifier never guesses
it, because the difference between "a server" and "somebody's laptop" is not
visible from a hostname or a MAC prefix.

It guesses in three passes, most reliable first:

1. **Hostname keywords.** A device that announces itself as `echo-kitchen`,
   `frontdoor-cam` or `PS5-1234` has told you what it is.
2. **The MAC's manufacturer prefix (OUI).** Fills in the vendor, and the class
   too when the hostname was silent: an Espressif chip is almost certainly
   something smart-home, a Ring prefix is a doorbell.
3. **The locally-administered bit.** A randomised MAC with no other signal is
   almost always a personal phone hiding its MAC, so it is classed personal.

**It only ever guesses about devices nobody has ruled on.** A row is a candidate
only when its `kind` is still unknown, its class is still the default
`personal`, it has no owner and it has no label. Anything a parent has touched
is left exactly as they left it. Before this, an SMS gateway filed by hand as an
appliance reverted to a personal device on the next sweep, which is worse than
never guessing at all: a guess must never beat a decision.

The vendor tables are curated rather than exhaustive, and extending them is a
one-line change: most homes contain the same handful of vendors.

If it guesses wrong, fix it by hand: `kidnet infra <mac>` for an access point,
or update `devices.category` directly for anything else.

---

## kidnet-dnslog

No arguments. Run every two minutes by `kids-dnslog.timer`.

Pages backwards through AdGuard's query log, newest first, stopping at the
newest timestamp already in `dns_log`. Maps the client address to a device and
then to a child, and inserts. `action` is `blocked` when AdGuard's reason starts
with `Filtered` or `Rewrite`, otherwise `allowed`.

Domains only, never content, because the network cannot see inside HTTPS. If
AdGuard is briefly unavailable (a restart, an upgrade) the run exits cleanly
and the next tick picks up what it missed.

| Variable | Default |
|---|---|
| `DNSLOG_PAGES` | `20` |

---

## kidnet-alerts

No arguments. Run by `kids-dnslog.service` as an `ExecStartPost`, so it always
sees rows that were just ingested.

Matches new `dns_log` rows against `flag_domains` and writes one `alerts` row
per match: Tor and darknet signals, darknet market directories, self-harm
forums, VPN downloads. The most specific pattern wins, so
`bridges.torproject.org` (deliberate block evasion) beats a plain
`torproject.org` lookup. At most one alert per child per category per day, so a
busy device cannot spam you.

An alert is a prompt to have a conversation, not a verdict. The self-harm
category is a care signal and never routes a child to a blocking page.

| Variable | Default |
|---|---|
| `ALERT_LOOKBACK` | `15 minutes` |

---

## kidnet-adguard

    kidnet-adguard [apply|render]

`render` prints the rules it would install. `apply` (the default) POSTs them to
AdGuard. `kidnet` calls `apply` after any change that affects the DNS layer.

AdGuard's custom rule list is a single global list, so this **renders the whole
list from the database every time**: one API call, no drift, idempotent. In
order:

1. Safety-net exceptions for every `scope='safety'` domain, as both
   `@@||domain^$important` and `@@||domain^$dnsrewrite`. The first beats every
   blocklist, the second beats the portal catch-all.
2. Flagged Tor, darknet and drugs on-ramps, redirected to the portal for every
   child, always. A plain blocklist entry gives a dead connection; the portal
   gives the warm "come find me, you are not in trouble" page. Self-harm
   patterns are deliberately excluded from this: that category never hits a
   blocking page.
3. Every active per-child category block, as a `$client` rewrite to the portal
   address.

| Variable | Default |
|---|---|
| `PORTAL_IP` | `192.168.60.1` |
| `ADGUARD_URL` / `ADGUARD_USER` / `ADGUARD_PASS` | as above |

---

## kidnet-adguard-clients

No arguments. Run automatically by `kidnet assign`.

AdGuard applies the age tier (SafeSearch, blocked services, per-client rules) by
client, and a client is identified by IP address. This points each child's
AdGuard client at exactly the addresses of the devices currently assigned to
them, so a tier can never land on the wrong device.

A child with no assigned devices is parked on a unique address in `192.0.2.0/24`
(RFC 5737, reserved for documentation and never routable), which is the closest
thing AdGuard offers to "matches nothing". Leaving stale IDs behind is the exact
bug this tool exists to fix. The guest catch-all client is never touched.

If a child has no matching AdGuard client, the tool says so and moves on rather
than creating one: client objects carry policy, and creating them silently
would hide a misconfiguration.

---

## kidnet-tor-sync

    kidnet-tor-sync [sync|emit|status]

- `sync` (default) fetches the current public Tor relay list and writes two
  files: a plain address list for the audit trail, and an `nft -f` snippet that
  flushes and refills the `tor_nodes` set in one transaction.
- `emit` prints `nft` commands built from the list already on disk, without
  fetching.
- `status` shows the list's size and age.

**It never loads anything into a live ruleset.** Applying the snippet is done by
`kids-tor-sync.service`, which pipes it into the gateway container. One writer,
no surprises.

Sources in order: Onionoo, the Tor Project's own directory API, then dan.me.uk
as a fallback (rate limited to one fetch per thirty minutes, so it is called
once and never retried). If both fail, or the result is under `TOR_MIN_NODES`,
the previous good files are left untouched and the command exits non-zero. A
stale list beats an empty one.

All relays, not just exits: a Tor client dials a guard (entry) relay, so the
widely shared exit lists, which exist for web servers refusing Tor visitors,
would block nothing in this direction.

| Variable | Default | Effect |
|---|---|---|
| `TOR_NODES_FILE` | `/var/lib/hearth/tor-nodes.txt` | plain list, one address per line |
| `TOR_NFT_FILE` | `/var/lib/hearth/tor-nodes.nft` | the generated nft snippet |
| `TOR_MIN_NODES` | `1000` | fewer than this means a bad fetch; refuse it |
| `TOR_CHUNK` | `500` | addresses per `add element` line |

This layer blocks default Tor, which is the version a curious kid actually
installs. It cannot block bridges or pluggable transports, which exist
specifically to defeat address lists. The honest version is in
[tor-and-safety.md](tor-and-safety.md).

---

## kidnet-iot-policy

    kidnet-iot-policy apply           regenerate and apply the policy chain
    kidnet-iot-policy learn           resolve vendor domains into vendor_ips, then apply
    kidnet-iot-policy status          the policy, and what the firewall has refused
    kidnet-iot-policy show <device>   the effective policy for one device
    kidnet-iot-policy mode off|observe|enforce
    kidnet-iot-policy set <device> <field> <value>
    kidnet-iot-policy allow <src> <dst> [note]
    kidnet-iot-policy revoke <src> <dst>
    kidnet-iot-policy dryrun          print the ruleset that WOULD be applied

The household security layer. Generates its own nftables sets and chain from
`device_policy_effective` (config/db/schema-policies.sql), the same way
`kidnet-servicemeter` generates its counters, so adding a device or changing a
rule is a database row rather than a firewall edit.

Policy is written in terms of who may START a conversation: may this device
reach the internet, and if so only its vendor's cloud; may the internet reach
it (never, by default); may it reach the other gadgets or your phones; and may
your phones reach it (yes, by default, because that is how you view your own
camera). Established replies are never re-judged.

The chain hooks forward at priority **-5**, ahead of `kids.nft`'s own forward
chain, so every existing drop still gets the last word and this layer can only
ever add a restriction. `@kids_allow` is returned from at the top, so no policy
here can touch the safety net.

`set` fields: `internet_out` (`none`, `vendor`, `full`), `inbound_from_wan`,
`talk_to_iot`, `talk_to_personal`, `reachable_from_personal` (yes or no), and
`vendor` (a row in `vendor_clouds`).

| Variable | Default | Effect |
|---|---|---|
| `IOT_POLICY_MODE` | the stored mode | override the mode for one run, without writing it |
| `IOT_POLICY_PRIORITY` | `-5` | the chain's nftables hook priority |
| `KIDS_SUBNET` | `192.168.60.0/24` | the island. No address outside it ever enters a policy set |
| `KIDS_IF` | `kids0` | the island interface |
| `IOTMAP_PAGES` | `15` | query-log pages read when learning vendor addresses |
| `GW_CONTAINER` / `NFT_NS` / `NFT_DIRECT` / `PG_CONTAINER` | as for the meters | |

`learn` resolves each vendor's domains and stores the answers in `vendor_ips`,
then reads AdGuard's query log for the CDN names a static list cannot know. It
reports how many addresses it resolved **and how many are now stored**, because
those two numbers used to differ silently: several of a vendor's domains resolve
to the same address, Postgres refuses an `ON CONFLICT DO UPDATE` that touches
one row twice in a command, and the error went to `/dev/null`. Every
vendor-restricted device therefore had an empty allow list, which the firewall
reads as no restriction at all. If the write fails now, it says so and raises an
urgent alert. Run `learn` a few times over a day or two before enforcing, and
check the stored count is not zero.

Alerts clear themselves. A successful `apply` retires the unacknowledged
`iot-policy` alerts before it, so a validation failure that has since been fixed
stops sitting on the dashboard claiming to be current. A validation or apply
failure now carries the nft error rather than dropping it.

After every successful apply it also checks for devices set to `internet_out=vendor`
whose brand it cannot identify. Those devices are **not restricted at all**, so
it raises a dashboard warning naming each one and the command that fixes it,
`set <device> vendor <brand>`. That used to be a line in a terminal nobody
reads. The alert text itself says `cloud <brand>`, which is not a valid field
name: the field is `vendor`. That is a bug in the alert's wording, recorded here
rather than papered over.

Fail-safe, in order of importance: a database outage changes nothing; `observe`
(the shipped default) turns every deny into a counter; a vendor with no learned
addresses leaves its devices unrestricted, reports the gap and warns on the
dashboard; and a ruleset that does not validate is not applied at all.

Honest limits, stated at length in
[HOUSEHOLD-SECURITY.md](HOUSEHOLD-SECURITY.md): a vendor on a large shared CDN
cannot be pinned tightly, a compromised device that only talks to its vendor is
still compromised, and two devices on the same access point can talk without
the gateway ever seeing it unless client isolation is on.

---

## kidnet-quiz

    kidnet-quiz list                      every bank, with its difficulty ramp
    kidnet-quiz validate <file>...        check a bank without installing it
    kidnet-quiz install <file> [--force]  validate, install, reload the portal
    kidnet-quiz remove <id>               take a bank off the portal
    kidnet-quiz stats [kid]               who has passed what, and how it is going
    kidnet-quiz reload [--container]      re-read the bank directory

The control surface for learn-to-earn content. A parent asks their agent for
"a quiz on the animals of Madagascar for a 12 to 15 year old", the agent writes
the JSON (`docs/runbooks/quiz-on-demand.md` is the recipe,
`portal/quizzes/FORMAT.md` is the shape), and this script checks it and puts it
in front of the kids.

`install` refuses anything that does not pass `tools/validate-quizzes.mjs`,
then re-validates the whole directory afterwards and pulls the file back out if
the set no longer passes. A bank with a wrong answer in it takes minutes off a
kid for being right, so nothing installs on trust.

`list` shows each bank's difficulty spread across levels 1 to 5, or `flat` for
a bank with no `difficulty` fields, which the portal samples at random instead
of ramping.

`stats` reads two things: the money trail in `time_events`
(`reason` like `quiz:%`), which is every pass ever, and the teaching record in
`quiz_rounds` / `quiz_answers` (config/db/schema-quizresults.sql), which is
every round including the failed ones and how the kid went at each difficulty
level. `remove` never deletes either: minutes earned stay earned.

| Variable | Default | Effect |
|---|---|---|
| `HEARTH_REPO` | the parent of `bin/` | where the banks and the validator live |
| `QUIZ_DIR` | `$HEARTH_REPO/portal/quizzes` | the bank directory |
| `PORTAL_UNIT` | `kids-portal.service` | the host portal reloaded with SIGHUP after a change |
| `PORTAL_CONTAINER` | `hearth-portal` | the island portal, signalled only with `reload --container` |

The island container is left alone unless you ask for it, because SIGHUP only
reloads a portal already running the code that handles it. On a box that has
not been redeployed since bank reloading landed, a HUP would stop the process
instead of reloading it.

---

## The test suites

Not in `bin/`, but part of the same surface. All seven need the stack or at
least Postgres, and five of them need root because they build throwaway
network namespaces.

Every suite checks its tools up front and exits with `MISSING REQUIRED TOOL`
rather than running, and every one that needs `nft` finds it with `command -v`
rather than assuming `/usr/sbin/nft` (Debian and Ubuntu put it there, Arch puts
it in `/usr/bin`). The TCP probes use bash's own `/dev/tcp` rather than netcat,
so there is no external binary left to be missing, and `chk_not` treats exit 127
as a hard failure. That combination matters more than it sounds: a negative
assertion whose probe never ran reports PASS, and eleven isolation guarantees
were doing exactly that on any machine without netcat. See DECISIONS.md.

    sudo test/firewall-test.sh        31 checks: the shipped ruleset, real packets, three namespaces
    sudo test/container-test.sh       26 checks: the real image, containment, replug, segment guard
    sudo test/iot-policy-test.sh      39 checks: the household IoT policy, real packets, six namespaces
    sudo test/meter-test.sh            8 checks: category minutes, budget enforcement, grant
    sudo test/service-meter-test.sh    5 checks: per-service bytes, active minutes, idle ignored
    sudo test/roles-test.sh           51 checks: the household roles, who each scope reaches, and the 11pm scenario
    ADGUARD_PASS=... test/adguard-test.sh   10 checks: the DNS layer, via AdGuard's own check_host API

`container-test.sh` skips one containment check when the interim
`hearth-share-gateway` service is running, because that service adds host NAT
for the island subnet on purpose.

`adguard-test.sh` is the only one that does not need root, and the only one that
needs the island profile up.

`roles-test.sh` needs root only for a network namespace: it builds its own copy
of the `kids_block` set in there rather than writing to the live gateway, so it
is safe to run on a household that is in use. It creates its own people and
devices, asserts, then deletes them and puts the category blocks it touched back
exactly as it found them.

After any change to `config/nftables/kids.nft`, `gateway/` or `bin/kidnet`, run
the firewall and container suites. Both must pass fully.
