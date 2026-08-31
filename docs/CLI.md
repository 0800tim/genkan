# CLI reference

Every command Genkan ships, what it takes, and what it actually does. Written
from the scripts themselves, so if this file and a script disagree, the script
is right and this file is a bug.

`bin/` holds every executable Genkan ships. One of them, `genkan`, is the
control surface a parent or an agent drives by hand. It was called `kidnet`
until 2026-08-31 and that name still works, as a shim, so old runbooks and
muscle memory do not break; new writing should say `genkan`. The background
workers keep their `kidnet-` prefix for now, because those names are wired
into systemd units on live boxes and renaming them is its own job. The rest are background workers
that timers run, plus `kidnet-report`, `kidnet-quiz`, `kidnet-quiz-suggest` and
`kidnet-pack`, which you run when you want to read something or to change what
the kids can learn from.

`deploy.sh` installs sixteen of them into `/usr/local/bin`. `kidnet-report`,
`kidnet-quiz`, `kidnet-quiz-suggest` and `kidnet-pack` are not among them: run
those from the repo, because they read files that live there.

| Command | Run by | What it is for |
|---|---|---|
| [`genkan`](#genkan) | you, or your agent | the control surface: on, off, categories, time, devices |
| [`kidnet-report`](#kidnet-report) | you, weekly | the family digest, read only |
| [`kidnet-health`](#kidnet-health) | you, any time | is the household's internet working and is Genkan doing its job. Read only |
| [`kidnet-upgrade`](#kidnet-upgrade) | you | update Genkan: check, snapshot, apply, undo itself if it breaks |
| [`kidnet-rollback`](#kidnet-rollback) | you | go back to a version that worked |
| [`kidnet-quiz`](#kidnet-quiz) | you, or your agent | manage the learn-to-earn quiz banks |
| [`kidnet-quiz-suggest`](#kidnet-quiz-suggest) | you, or your agent | brief an agent on what one child should be quizzed on next |
| [`kidnet-pack`](#kidnet-pack) | you | install, list and remove learning packages other people wrote |
| [`kidnet-meter`](#kidnet-meter) | `kids-meter.timer` | ticks a minute off each active child's daily budget |
| [`kidnet-schedule`](#kidnet-schedule) | `kids-schedule.timer` | applies scheduled bedtimes, and lifts them in the morning |
| [`kidnet-catmap`](#kidnet-catmap) | `kids-metering.timer` | learns which addresses are gaming, video or a download |
| [`kidnet-catmeter`](#kidnet-catmeter) | `kids-metering.timer` | counts active category minutes, enforces category budgets |
| [`kidnet-servicemap`](#kidnet-servicemap) | `kids-services.timer` | learns which addresses are YouTube, Netflix, Roblox and so on |
| [`kidnet-servicemeter`](#kidnet-servicemeter) | `kids-services.timer` | counts real bytes per service per device |
| [`kidnet-devicescan`](#kidnet-devicescan) | `kids-devicescan.timer` | pulls DHCP leases into the devices table |
| [`kidnet-classify`](#kidnet-classify) | `kidnet-devicescan` | guesses personal, IoT or infrastructure for each device |
| [`kidnet-dnslog`](#kidnet-dnslog) | `kids-dnslog.timer` | pulls AdGuard's query log into `dns_log` |
| [`kidnet-alerts`](#kidnet-alerts) | `kids-dnslog.service` | raises alerts on flagged domains just ingested |
| [`kidnet-notify`](#kidnet-notify) | `kids-notify.timer` | sends unacknowledged alerts to the phone routes a household set up |
| [`kidnet-adguard`](#kidnet-adguard) | `genkan`, on every change | renders category blocks into AdGuard's rule list |
| [`kidnet-adguard-clients`](#kidnet-adguard-clients) | `genkan assign` | points each child's AdGuard client at their real device IPs, and gives each shared family device one of its own |
| [`kidnet-tor-sync`](#kidnet-tor-sync) | `kids-tor-sync.timer` | fetches the public Tor relay list for the firewall |
| [`kidnet-iot-policy`](#kidnet-iot-policy) | `kids-iot-policy.timer` (installed, off by default) | generates the household IoT security policy from the database |

Everything talks to Postgres through `docker exec -i postgres psql`, so the
tools need the `postgres` container running and the Docker socket readable.
The tools that talk to AdGuard need `ADGUARD_PASS` in the environment, which
is why the timer units all carry `EnvironmentFile=.../secrets.env`.

---

## genkan

The one command a parent or an agent uses. Run it with no arguments to print
this same summary from the script's own header.

State lives in Postgres. `genkan` writes the desired state, then pushes it to
the two enforcement planes: nftables (via `docker exec hearth-gw nft`) for the
coarse internet switch, and AdGuard (via `kidnet-adguard`) for per-category DNS
blocks. If the firewall is not loaded yet, `genkan` says so and still records
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
  yet. This is what bedtime uses.
- `dinner` the same people as `all`, plus every shared family device ticked for
  dinner. This is what `dinner` uses.
- `everyone` literally every personal device, adults included

`all` is deliberately not `everyone`: a control aimed at the kids must never
reach a visiting grandparent, but it must still catch a tablet nobody has named
yet. A guest who has been marked gone home is in no group at all.

Which group somebody falls in is decided by their role (`child`, `guest-child`,
`guest-adult`, `adult`), and the answer lives in the database, in
`people_in_scope()`. See [HOUSEHOLD-ROLES.md](HOUSEHOLD-ROLES.md).

**Groups only ever touch devices classified `personal` or `shared`.** Cameras,
locks, speakers and other IoT, appliances and the access point are never cut by
`genkan off all`, by `dinner` or by `genkan house off`. See
[device classification](#kidnet-classify).

There is one more scope, `house-off`, which is every device ticked for the
whole-house cut and no people at all. It is deliberately not in the list above,
so `genkan off house-off` is refused. The only door to it is `genkan house off`,
which also sets the clock that makes the cut lift itself.

### Internet on and off

    genkan off <person|group>
    genkan on  <person|group>

Adds or removes that person's reserved addresses in the nftables `kids_block`
set and records it in `category_state`. A blocked device keeps DHCP, DNS, the
captive portal and the safety net: it does not fall off the network, it lands
on the "time's up" page.

    genkan dinner        # everyone but the adults, plus the shared devices
                         # ticked for dinner
    genkan resume        # and back on again

### The whole-house cut

    genkan house off [minutes]     one button: everything ticked for it goes off
    genkan house on                end it now
    genkan house status            is it running, and what would it catch

`minutes` defaults to 60 and is capped at 1440. **The cut lifts itself when the
time is up.** No rows are written against any device: `house_state` holds one
timestamp, the `blocked_device_ips` view reads the clock, and the gateway's
fifteen-second reconcile drops the addresses when it passes. That is deliberate.
A cut you have to undo by hand is a cut that can outlive the reason for it, and
the person who pressed it is often the person who has left the house.

It never touches a smart home device, an appliance or the access point, and the
safety net still answers on every device. `genkan house on` takes out only the
addresses nothing else still says should be blocked, so ending a house cut
cannot hand the internet back to a child who is out of time.

### Shared family devices, and the two tick boxes

    genkan shared <mac|ip> [label] [tier]        file it as the household's
    genkan sweep  <mac|ip> dinner|house on|off|default

A shared family device is the lounge television or the iPad every kid uses. It
belongs to the household rather than to one child, so nobody's minutes pay for
it, and it carries its own filter level (Standard unless you say otherwise)
because a device with no level falls through to the household catch-all, which
blocks ads and malware and nothing else.

`sweep` sets one tick box: whether this device is caught by the dinner pause,
and whether it is caught by the whole-house cut. `default` clears your answer
and puts the device back to whatever its class does by default, which is: a
personal or shared device is in both, and a smart home device, an appliance or
the access point is in neither, always. Ticking a box on one of those three is
refused, because the answer is computed in the `device_sweeps` view and is not
the tick box's to give.

    genkan sweep 192.168.60.72 dinner off    # the display that plays music

### Categories

    genkan game  off|on <kid>     gaming: Roblox, Fortnite, Steam, consoles
    genkan media off|on <kid>     video + social; Spotify and audio stay up
    genkan study on|off <kid>     gaming + video + social off together

All three write `category_state` and then call `kidnet-adguard apply`, which
answers that category's domains with the portal address for that child only.
`study on` is exactly `game off` plus `media off`; `study off` clears all three.

Turning a category back **on** also returns it to full speed, so a category
that was slowed, then switched off, then switched on again cannot come back
still crawling with nothing on screen to say why.

### The slow lane

    genkan slow <kid> <gaming|video|social|media|internet>   turn it down, do not cut it
    genkan full <kid> <gaming|video|social|media|internet>   back to full speed
    genkan slow-rate [kbit]                                  how slow the slow lane is
    genkan slow-timeout [cut|slow]                           what running out of time does
    genkan slow-status                                       who is slowed, and the settings

A third state between on and off. Instead of cutting a category dead, the
gateway polices it down to a few hundred kilobits: the video still plays, it
just buffers, and the child drifts off to something else on their own. Nobody
was told no, so there is nothing to argue about. See
[DECISIONS.md](../DECISIONS.md) for why that is a better lesson than a wall.

Each category is in exactly one of three states, and they all live on the one
`category_state` row, so there is one place to read and nothing to keep in
step:

| State | Row | What the child gets |
|---|---|---|
| off | `blocked = true` | cut, portal explains, safety net still answers |
| slow | `blocked = false`, `speed = 'slow'` | works, policed down to the household rate |
| full | `blocked = false`, `speed = 'full'` | normal, and the default |

Choosing `slow` or `full` always lifts a block, because that is what a parent
means when they pick one. `media` is video and social together, exactly as it
is for `genkan media off`.

`slow-rate` takes 32 to 9999 kbit/s and defaults to **256**. It is stored in
`slow_settings`, and the gateway re-renders the firewall's throttle chain with
it on its next reconcile, so it is live within fifteen seconds. It is not
applied by this command directly: the database is the desired state, the
firewall follows.

`slow-timeout` decides what running out of time does. `cut` is the default and
is what Genkan has always done: the internet goes off and the captive portal
explains. `slow` drops the child into the slow lane instead, so the evening
tails off rather than ending mid-sentence. Some families want the cliff and
some want the slope; neither is assumed, and an upgrade never changes it.

Earning time back lifts either shape of out-of-time, and only that shape, the
same way `reopen` always has: a bedtime still cannot be bought back.

**The safety net is never slowed.** The help lines and the reading list sit
above every throttle rule in the firewall, in both directions, and
`test/firewall-test.sh` proves it on an address that is otherwise inside a
throttled category. **Smart home, appliances and infrastructure are never
slowed either**: the view the gateway reads (`slow_lane_ips`) can only ever
return a personal device, and `test/schema-test.sh` proves that too.

### Time

    genkan time    [kid]                    minutes left today, or everybody
    genkan bonus   <kid> <min> [why]        grant general minutes, reopens the internet
    genkan grant   <kid> <gaming|video> <min>   grant minutes to ONE category
    genkan earn    <kid> <task|min>         credit a named task's minutes, or a raw number
    genkan penalty <kid> <min> [why]        dock minutes
    genkan spend   <kid> <min>              consume minutes; at zero, cuts or slows

    genkan reopen  <kid>                    lift an out-of-time block, and nothing else

`bonus`, `earn` and `penalty` all write `time_ledger.bonus_min` and an audit row
in `time_events`. `bonus` and `earn` reopen the internet if the child now has
minutes left, through `reopen`.

What `spend` does at zero depends on `genkan slow-timeout`. By default it cuts
the internet and stamps `set_by='out-of-time'`. Set to `slow`, it puts the
child in the slow lane instead and cuts nothing; a row that is already blocked
for another reason, a bedtime say, is left completely alone.

`reopen` is narrow on purpose. It clears an internet block **only** where
`set_by` is `out-of-time` or `earned-back`, and marks it `earned-back`. It will
not touch a block a parent set by hand, a category over its budget, or a
scheduled bedtime. Until this existed, `bonus` and `earn` called `genkan on`,
which stamps `set_by='agent'` over whatever was in the row, so a chore approved
at half past ten cancelled that child's bedtime. Time can be earned; bedtime
cannot be bought. The dashboard's chore approval calls this same verb.

`grant` is the per-category equivalent: it raises `category_budgets.daily_min`
for gaming or video by that many minutes and clears an over-budget block for
that category. It will not clear a block a parent set, only one the meter set
(`set_by='over-budget'`). Any other category name is refused.

`earn <kid> <task>` looks the task up in the `tasks` table with a fuzzy `ILIKE`
match and uses its minutes. If nothing matches, the argument is treated as a
number of minutes.

A child on the teen tier has no daily budget. That is stored as 999 in
`time_ledger`, which the meter treats as unlimited, and `genkan time` prints
"no daily limit (teen tier)".

`genkan time` with no name reports the whole house: one line per active child
and guest child, in name order. It used to die with a raw bash parameter error,
which reached the dashboard verbatim.

### Bedtimes

    genkan schedule <anything>   passed straight through to kidnet-schedule

The times a child's internet goes off and comes back are their own script, the
same way the household IoT policy is. See [kidnet-schedule](#kidnet-schedule).

### The safety net, and the reading list

    genkan allow-sync      resolve scope='safety' and scope='learn' domains into @kids_allow
    genkan allow-status    print what is currently in that set

`allow-sync` resolves every `always_allow` row with `scope='safety'` or
`scope='learn'` with `getent`, and loads the addresses into `@kids_allow`. It
refuses to install an empty result: a resolver blip leaves the old list in place
rather than leaving a child unable to reach 1737.

Two scopes, one nft set, because the firewall matches addresses and does not
care why. The scopes are kept apart in the database because the two promises are
different and a parent should be able to reason about them separately:

- `safety` is the youth help lines and schoolwork. It must never be narrowed.
- `learn` is the reading list: reference sites a child can still reach when
  their time has run out, so learn-to-earn is not just a memory test. It is a
  household's to choose. Around forty domains, seeded by
  `config/db/schema-learn.sql` and `config/db/schema-learn-intl.sql`, with the
  rule and the rejections in [READING-LIST.md](READING-LIST.md).

`scope='category'` rows (Spotify) are deliberately not in here: audio outlives
"media off" at the DNS layer, and does not outlive dinner.

You rarely need to run this. The gateway container does the same sync at start
and once an hour on its own.

### Household devices

    genkan iot status                    what the policy is, and what it has refused
    genkan iot show <device>             the effective policy for one device
    genkan iot learn                     refresh the vendor address lists, then apply
    genkan iot apply                     regenerate the firewall from the policy rows
    genkan iot set <device> <field> <value>
    genkan iot allow <phone> <device>    let one device reach another
    genkan iot mode off|observe|enforce

A pass-through to [`kidnet-iot-policy`](#kidnet-iot-policy), so there is one
control surface. This is the household layer, not the kid layer: what each
camera, lock, speaker and vacuum is allowed to talk to. Read
[HOUSEHOLD-SECURITY.md](HOUSEHOLD-SECURITY.md) before switching it on.

### Devices and people

    genkan devices                      the full roster, with owner and online state
    genkan unassigned                   devices with no owner set yet
    genkan leases                       current DHCP leases
    genkan assign <mac|ip> <person> <label> [reserved-ip]
    genkan shared <mac|ip> [label] [tier]   file it as a shared family device
    genkan infra <mac>                  mark a device as infrastructure (an AP, a switch)
    genkan person add <name> <child|guest-child|guest-adult|adult> [tier]
    genkan person list                  who is in the house, by role
    genkan guest leave <name>           they have gone home
    genkan guest back <name>            they are visiting again
    genkan guest list                   the visitors here right now

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

### Device claiming

    genkan claim-mode                    what mode claiming is in, and how many devices are unclaimed
    genkan claim-mode off|observe|enforce
    genkan unclaimed                     personal devices that belong to nobody
    genkan claims                        self-claims waiting for a parent to agree
    genkan confirm <device|address>      say yes to one of them

**Off by default.** A household running happily today must not find devices in
a restricted lane because it pulled an update, so `claim_settings.mode` ships
as `off` and nothing here does anything until you change it. The three modes:

| Mode | What happens to a device nobody owns |
|---|---|
| `off` | nothing. A DHCP lease is enough, exactly as before |
| `observe` | nothing is restricted. `genkan unclaimed` tells you what enforcing would catch |
| `enforce` | it gets DNS, the portal and the safety net, and nothing else |

Enforcing works through the `kids_unclaimed` nft set, which the gateway
reconciles from the `unclaimed_devices` view on its usual fifteen second tick.
The set sits **below** the `@kids_allow` safety net in the ruleset, so an
unclaimed device can still reach the help lines and the reading list, and its
port 80 is redirected to the portal so a child sees the claim page rather than
a dead connection.

A child claiming a device at that page gains nothing on its own: the device is
marked `claim_pending` and stays in the restricted lane until a parent runs
`genkan confirm` or presses the button on the dashboard. That is the whole
design, and the reasoning is in [DEVICE-IDENTITY.md](DEVICE-IDENTITY.md).
Smart home kit, appliances and infrastructure are never expected to announce
themselves and never appear in `genkan unclaimed`.

### Looking around

    genkan status              which categories are blocked, per child
    genkan recent <kid> [n]    that child's last N domains (default 25, last 24 hours)
    genkan topsites [n]        busiest allowed domains today across all children (default 15)

### Input validation

Everything a person types is gated before it reaches SQL, because the dashboard
feeds this script over HTTP and the household bug bounty invites the kids to
attack it:

- names: `[A-Za-z0-9_-]`, 1 to 32 characters. Group controls work by database
  id rather than by name, so a household that already holds an awkwardly named
  person can still use `genkan off kids`; only addressing that person
  individually is refused.
- numbers: digits only, at most 4
- free text (reasons, labels): letters, digits and `_ : + . , -` and spaces, at
  most 80 characters

Four more gates sit beside those three: a signed number (a penalty is minutes
with a minus in front), a row id, a MAC-or-IPv4 address, and an IPv4 address on
its own.

A row limit is not exempt from any of it, and used not to be gated. `genkan
recent` and `genkan topsites` interpolated their `[n]` straight into SQL, both
are on the dashboard's HTTP allowlist, and `psql -c` will happily run a second
statement, as the Postgres superuser. It was proven end to end before it was
fixed. Both now run their argument through `ck_int` like everything else.
Adding a verb to this script means gating every argument it takes, including
the ones that are obviously numbers.

Two rules learned the hard way, worth following when you add a verb:

- **An id read back out of the database is still an argument.** Most of the
  values that reach a `WHERE` here came from Postgres rather than from a
  parent's typing, and that is exactly the assumption that turns one bad write
  into a second injection. They go through `ck_id` too.
- **Gate before you query.** `genkan assign` used to check its optional
  reservation next to the statement that used it, which sat after the person
  lookup, so whether a bad reservation was refused depended on whether the
  person existed. Check every argument before the first connection is opened.

### Which database role it connects as

`genkan` and every `kidnet-*` worker connect as **`kids_agent`**, not as the
Postgres superuser, and not as the `kids_app` role the dashboard and portal
use. `kids_agent` cannot run `COPY ... TO PROGRAM`, read a server file, drop or
truncate a table, delete a child or a day of history, or escalate itself. Its
grants are one line per table in `config/db/grants.sql`, and adding a verb that
touches a new table means adding a line there or the verb answers `permission
denied`. `test/db-role-test.sh` proves the fence, and `docs/DATABASE.md`
explains the three places that are still on the superuser path on purpose.

### Environment

| Variable | Default | Effect |
|---|---|---|
| `GW_CONTAINER` | `hearth-gw` | which container holds the island's namespace |
| `NFT_DIRECT` | unset | set to `1` to run `nft` on the host instead (the no-Docker variant) |
| `NFT` | `/usr/sbin/nft` | the `nft` binary, when `NFT_DIRECT=1` |
| `PG_CONTAINER` | `postgres` | the container Postgres runs in |
| `HEARTH_DB` | `kids_network` | the database to talk to |
| `HEARTH_DB_ROLE` | `kids_agent` | the Postgres role to connect as |
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
skipped), then calls `genkan spend <kid> 1`. At zero, `genkan` blocks their
internet and marks the block `set_by='out-of-time'`, which is the only kind of
block a quiz can lift.

This is the whole-internet minute meter. Per-category minutes are counted
separately by `kidnet-catmeter`.

---

## kidnet-schedule

    kidnet-schedule [apply]                          apply the schedules (what the timer runs)
    kidnet-schedule show [kid]                       what is set, what is in force, when it lifts
    kidnet-schedule set <kid> <days> <HH:MM> <HH:MM> [categories]
    kidnet-schedule clear <kid>                      remove that child's bedtimes
    kidnet-schedule enable|disable <kid>             keep the times, stop or start them firing
    kidnet-schedule extend <kid> <min>               tonight only, no schedule edited
    kidnet-schedule holiday <from> <to> [name]       no bedtimes between those dates
    kidnet-schedule holiday late <from> <to> <min> [name]
    kidnet-schedule holiday clear                    end every override window now

Run every minute by `kids-schedule.timer`, and reachable as `genkan schedule
...`. The dashboard's Family page sets the same rows through `/api/schedule`.

`<days>` is `school` (Sunday to Thursday nights), `weekend` (Friday and
Saturday nights), `every`, or a list like `0,1,2,3,4` where 0 is Sunday. The
days are the nights the window **starts** on, which is what makes a Friday
night different from a Tuesday night. An end time earlier than the start time
means the window crosses midnight, which every bedtime does; there is no flag
for it.

`[categories]` is a comma list from `internet`, `gaming`, `video`, `social`.
It defaults to `internet`, the whole thing. The safety net and the reading list
survive a bedtime exactly as they survive every other cut.

### What it does each minute

Three statements, in this order, and the order is the design:

1. **Releases.** If a parent turned something back on during a window the
   worker had already asserted, that is recorded against the window
   (`schedule_state.released_key`) so step 2 leaves it alone. It runs first, or
   a parent's override would live for one minute.
2. **Assert.** Block what the window calls for, marking it `set_by='bedtime'`,
   but never over a block somebody else owns and never in a window a parent has
   released.
3. **Lift.** Anything still blocked with `set_by='bedtime'` that no window in
   force calls for. Driven off `category_state` rather than off the `schedules`
   table on purpose: a schedule deleted, disabled or edited mid-window would
   otherwise leave a child blocked with nothing left to lift it.

Nothing here touches nftables. The database is the desired state and the
gateway container reconciles the firewall from it every 15 seconds, which is
also why a reboot mid-bedtime comes back blocked: the block is a row, not a
rule somebody has to remember to re-add. The DNS layer is pushed with
`kidnet-adguard apply` when a change actually happened, because
`gaming`, `video` and `social` bedtimes are enforced there.

### The set_by rules

A schedule owns **only** the blocks it applied. The full precedence table is in
DECISIONS.md; the short version:

| `set_by` | who set it | may a schedule lift it? |
|---|---|---|
| `agent` | a parent, by hand or on the dashboard | never |
| `out-of-time` | `kidnet-meter`, at zero minutes | never |
| `over-budget` | `kidnet-catmeter`, a category over its cap | never |
| `bedtime` | this worker | yes, and only this worker |
| `schedule-lifted` | this worker, in the morning | n/a, it is not a block |

And in the other direction: a parent's `genkan on` during a bedtime holds until
the next window boundary, not for one minute; earning time back cannot lift a
bedtime (see `genkan reopen`); and an empty `schedule_state` means assert, so a
restored backup or a fresh state table fails towards the bedtime being in force
rather than towards the child being online.

### Time and place

Every date and time is worked out in the database's own timezone, which
`deploy.sh` pins to `HEARTH_TZ`. That is the same clock the daily budget rolls
over on, so a bedtime and a day boundary can never disagree.

The maths lives in one SQL function, `schedule_windows(at timestamptz)`, which
takes the moment as an argument instead of reading the clock. That is what
lets `test/schedule-test.sh` prove a Tuesday, a Friday and a Saturday morning
without waiting for any of them. Two views read it: `schedule_next` (one row per
child, the window running now or the next one due) and `schedule_holding` (what
is off right now because of a bedtime rather than because of a parent).

### Environment

Same three overrides as `bin/genkan`: `PG_CONTAINER`, `HEARTH_DB` and
`HEARTH_DB_ROLE`. It connects as `kids_agent`. `ADGUARD_PASS` is optional; with
it unset the DNS push is skipped and the database is still the truth.

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
`last_seen` and `dhcp_leases`, which is what `genkan leases` prints. Then it
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

Every device sits in one of five classes, which decides how it is treated:

| Class | What it is | How Genkan treats it |
|---|---|---|
| `personal` | a phone, tablet, laptop, console | assignable to a person, filtered and metered by their tier |
| `shared` | the lounge TV, the iPad every kid uses | the household's, not one child's. Its own filter level, nobody's minutes, and swept by `dinner` or `genkan house off` only where the parent has ticked it |
| `iot` | cameras, locks, speakers, vacuums, lights, plugs, thermostats | never assigned, never metered, **never cut** by `genkan off all`, `dinner` or `genkan house off` |
| `appliance` | an SMS gateway, a build agent, a media server: nobody's device, but not smart-home kit either | full internet, no owner, no time limits, never caught by any control |
| `infra` | the access point, switches, the gateway itself | not a client at all |

The `iot` row is the one worth saying out loud: your smart lock, your doorbell
and your security camera stay online when you pause the kids at bedtime,
because the group commands only ever touch `personal` and `shared` devices.
Nobody's front door goes offline because a fourteen year old ran out of time.

`shared` (`config/db/schema-shared.sql`) and `appliance`
(`config/db/schema-appliance.sql`) are both a parent's decision, made in the
owner picker on the dashboard's Devices page or with `genkan shared`. The
classifier never guesses either, because the difference between "a server" and
"somebody's laptop", or between "the family TV" and "the eldest's monitor", is
not visible from a hostname or a MAC prefix.

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

If it guesses wrong, fix it by hand: `genkan infra <mac>` for an access point,
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

**If the check itself fails, it says so.** A query that errors used to print to
a terminal nobody was reading, count nothing and report "nothing new", which is
exactly what a quiet night looks like. It now raises an urgent `alert-check`
alert of its own, visible on the dashboard, and the next good run retires it.
The exit status is non-zero too, but the alert row is the surface that matters:
the unit runs this as `ExecStartPost=-` so a failed check cannot fail the DNS
ingest that feeds it, which means systemd ignores the status by design.

To sweep a longer window than the timer does, for instance after fixing an
outage, set the lookback for one run:

    ALERT_LOOKBACK="2 days" kidnet-alerts

| Variable | Default |
|---|---|
| `ALERT_LOOKBACK` | `15 minutes`. Must read as an interval, like `2 days`. |

---

## kidnet-notify

    kidnet-notify run                     send what is owed (the timer runs this)
    kidnet-notify pending                 what would go next, without sending it
    kidnet-notify list                    the routes, their state and their last result
    kidnet-notify test <route>            send a harmless test message now
    kidnet-notify log [n]                 the last n attempts, good and bad
    kidnet-notify add <kind> <name> [options]
    kidnet-notify set <name> [options]
    kidnet-notify on <name> | off <name> | remove <name>

Puts Genkan's alerts on a parent's phone. Reads unacknowledged `alerts` rows and
POSTs the ones a household asked for, to an address the household typed in. It
talks to no cloud and no vendor: with no routes configured it sends nothing to
anybody and says so, which is what a fresh install does.

Kinds that are **built and tested**: `ntfy`, `webhook`. Kinds that are
**documented extension points and refused**: `email`, `homeassistant`. A route
it cannot send on is refused at creation, rather than accepted and left silently
broken.

Options for `add` and `set`:

| Option | What it does |
|---|---|
| `--target URL` | where to send. Leave it off and you are prompted, which keeps the URL out of your shell history and out of `ps`. |
| `--token TOKEN` | optional bearer token, for a protected ntfy or webhook |
| `--severity S` | `info` (everything), `warn` (the default), `urgent` (only those) |
| `--categories a,b` | only these alert categories. Left off, all of them. |
| `--quiet HH:MM-HH:MM` | quiet hours, or `off`. May cross midnight. |
| `--quiet-urgent yes|no` | whether urgent still goes through during quiet hours. Default yes. |
| `--detail yes|no` | may this route carry an alert's own text? Default no, and it can never widen past what `notify_wording.detail_ok` allows. |
| `--rate N` | most ordinary messages an hour. Default 6. |

**For an ntfy route the topic name is the password.** Make it long and random,
and prefer your own ntfy server. The target and the token live only in the
database and are never written to a file, a log line or a command line.

The four things it promises: never the same alert to the same route twice
(a database constraint, not a code path); a burst collapses into one message
(twelve unknown devices is one notification saying "12 devices"); routine alerts
are quiet by default and quiet hours hold everything but the urgent; and a route
that is down loses nothing, breaks nothing and exits 0, leaving the alert
unacknowledged so it goes next time.

A notification says that something needs your eyes and where to look. The detail
stays on the dashboard, at home. The self-harm alert in particular names no
child, quotes no site and does not say what it is about, because it is read on a
lock screen wherever the phone happens to be. The whole reasoning, and the exact
words, are in [NOTIFICATIONS.md](NOTIFICATIONS.md).

| Variable | Default |
|---|---|
| `NOTIFY_MAX_AGE` | `12 hours`, the horizon past which an unsent alert is retired rather than fired at a phone |
| `NOTIFY_TIMEOUT` | `10` seconds per HTTP attempt |

---

## kidnet-adguard

    kidnet-adguard [apply|render]

`render` prints the rules it would install. `apply` (the default) POSTs them to
AdGuard. `genkan` calls `apply` after any change that affects the DNS layer.

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

No arguments. Run automatically by `genkan assign`.

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

A **shared family device** gets a client of its own too, named after the device,
on the level in `devices.policy_tier`. It belongs to nobody, so no person's tier
can carry it, and without one it falls through to the household catch-all, which
blocks ads and malware and nothing else. Clear its level and the client is
removed. A shared device whose label is also a person's name is skipped, because
AdGuard keys clients by name and building it would overwrite that person's.

---

## kidnet-tor-sync

    kidnet-tor-sync [sync|emit|status]

- `sync` (default) fetches the current public Tor relay list, loads the
  addresses into the `tor_nodes` table, and writes two files: a plain address
  list for the audit trail, and an `nft -f` snippet you can apply by hand on a
  box with no database.
- `emit` prints `nft` commands built from the list already on disk, without
  fetching.
- `status` shows three separate answers, because they are three separate
  questions: what the file holds, what the database holds, and **what the
  firewall is actually enforcing**.

**It never loads anything into a live ruleset.** The gateway rebuilds
`@tor_nodes` from the database at startup and hourly, the same way it rebuilds
every other set it enforces. One writer, no surprises.

That last part is new, and it is worth saying why. There used to be a second
step in `kids-tor-sync.service` that piped the snippet into the gateway,
guarded by "skip if the gateway has no `tor_nodes` set yet". `deploy.sh` runs
the unit immediately after recreating the gateway, which is exactly when the
gateway is in its segment-guard wait with no firewall loaded, so the guard
fired every time, the apply was skipped every time, and the unit reported
success every time. The set was empty and nothing said so.

A fetch that cannot reach the firewall is not a blocklist. `kidnet-tor-sync
status` and `kidnet-health` both now ask the firewall directly rather than
looking at the age of a file.

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

## kidnet-pack

    kidnet-pack list                      what is installed, and what is on the shelf
    kidnet-pack validate <file>...        check a package without installing it
    kidnet-pack install <file> [--force]  validate, then install it for the kids
    kidnet-pack remove <id> [--off]       remove it, or just take it off the list

Community learning packages. A package is one JSON file: a quiz bank, plus who
wrote it, what licence it carries, who it is for, and optionally a short piece
to read first. It is the bank format with one optional block added: forty-one of
the forty-two banks that ship with Genkan pass every package check unchanged,
manifest aside. `docs/CONTRIBUTING-CONTENT.md` is the guide for writing one,
written for somebody who is not a programmer.

**Why this is not `kidnet-quiz install`.** That command copies a bank file into
`portal/quizzes`, which is tracked in git: a `git pull` would delete a family's
installed content and a repo update would overwrite it. A package goes into the
**database** instead, alongside the banks a parent writes on the dashboard
(`config/db/schema-packages.sql`). Updating Genkan cannot touch it, removing it
is one row, and the children's earned minutes stay earned either way, because
`quiz_rounds` has no foreign key to the bank.

`validate` and `install` are both strict: a package a household installs has to
say who wrote it and under what licence. To check a plain bank that has no
manifest yet, call the validator directly with
`node tools/validate-package.mjs <file>`.

Install refuses three things before anything reaches the database: a package
that fails `tools/validate-package.mjs --strict`, an id that a file bank in
`portal/quizzes` already owns (a file bank wins on the portal, so the package
would install and never be seen), and an id that is already installed unless you
pass `--force`. Re-installing replaces every question, which is how a package
takes an update.

`remove` will only ever touch a bank that arrived as a package, so it cannot
delete a bank a parent wrote on the dashboard whatever id is handed to it.
`--off` takes it off the kids' list without removing it.

The whole package goes into Postgres as one `jsonb` value, through
`install_quiz_package()`, so the install is a single transaction and there is
one string to quote rather than hundreds. That function is `SECURITY DEFINER`,
which is what lets `kids_agent` install a package without being granted write
access to every quiz bank in the house.

**It touches no network.** There is no package registry, no download, no update
check and no telemetry. A package arrives as a file, put there by a person. The
portal notices an installed package within about half a minute, because it polls
the database shelf, so nothing needs restarting.

| Variable | Default | Effect |
|---|---|---|
| `HEARTH_REPO` | the repo above `bin/` | where to find the validator and the shelf |
| `PACK_SHELF` | `$HEARTH_REPO/portal/quizzes/community` | the shelf `list` reads |
| `HEARTH_DB` | `kids_network` | the database to install into |
| `HEARTH_DB_ROLE` | `kids_agent` | the Postgres role to connect as |

`test/package-test.sh` (31 checks) is the suite behind this: it builds fourteen
hostile packages, proves each is refused, then forces one into the database by
hand and proves the portal still renders it inert.

---

## kidnet-quiz-suggest

    kidnet-quiz-suggest                     the children it can brief on
    kidnet-quiz-suggest <kid>               the briefing
    kidnet-quiz-suggest <kid> --days 60     a longer window (default 30)
    kidnet-quiz-suggest <kid> --top 15      more rows per section (default 10)
    kidnet-quiz-suggest <kid> --quiet       the briefing without the closing prompt

The research half of "keep feeding them new quizzes". It gathers what one
child passes, what they avoid, which questions they keep getting wrong, what
their devices have been looking up that nothing else explains, and which bank
ids are taken, then prints it as one briefing with a prompt on the end.
`docs/runbooks/quiz-suggestions.md` is the recipe for what to do with it.

**It calls no AI service.** It reads Postgres and `portal/quizzes`, and writes
to your terminal. Genkan has no telemetry and talks to no cloud, and this
script is not the exception. Handing the output to an agent is a decision you
make, one paste at a time.

Every section says so plainly when it is empty, and says so differently when
the query failed, because "nothing yet" and "this broke" are not the same
answer. A fresh install prints a briefing that is mostly empty, which is
correct: there is nothing to go on until the kids have taken some rounds and
`kids-dnslog.timer` has filled `dns_log`.

| Variable | Default | Effect |
|---|---|---|
| `HEARTH_REPO` | the parent of `bin/` | where the banks live |
| `QUIZ_DIR` | `$HEARTH_REPO/portal/quizzes` | the file bank directory |
| `PG_CONTAINER` | `postgres` | the Postgres container |
| `KIDS_DB` | `kids_network` | the database |

---

## The tools directory

Not in `bin/`, not installed by `deploy.sh`, and not part of the running
system. These are run by hand from the repo.

| Script | What it does |
|---|---|
| `tools/validate-quizzes.mjs` | checks every bank in `portal/quizzes` against the format: valid JSON, four choices, an in-range `answer_index`, ids unique, difficulty labelled on all questions or none, and the bank at least 4x `questions_per_round` |
| `tools/worktree-snapshot.sh` | snapshots the working tree to a private git ref, so a bad git command cannot destroy uncommitted work |
| `tools/publish.sh` | the pre-publish scan: looks for real MACs, addresses, names and secrets in tracked files before anything goes public |
| `tools/enable-https.sh` | fetches a tailnet certificate and puts Caddy in front of the dashboard on :8443 |

### tools/worktree-snapshot.sh

    tools/worktree-snapshot.sh save               commit the whole tree to the snapshot ref
    tools/worktree-snapshot.sh list [n]           what snapshots exist (default 20)
    tools/worktree-snapshot.sh show <ref>         what changed in one
    tools/worktree-snapshot.sh restore <ref> <path>   put one file back

It exists because `git checkout dashboard/portal.mjs` discarded an agent's
uncommitted work and there was nothing to recover from.

Every `save` commits the entire working tree, tracked and untracked, to
`refs/hearth/snapshots`. That ref never appears in the branch history, is never
pushed, and never touches what you have staged: the script uses an index file
of its own (`.git/hearth-snapshot-index`). If the tree has not changed since the
last snapshot it exits without committing, so identical commits do not pile up.
Recovery is then an ordinary git operation, which is the point: the snapshots
are readable by any git tool, not by a bespoke one.

`SNAPSHOT_KEEP` (default 200) is read but nothing prunes yet: git already
deduplicates blobs, so an unchanged tree costs almost nothing to snapshot.

The script is in the repo. **The timer is not**, because how often you want it
and whether you want it at all is not a household concern of Genkan's. On the
reference box it is a user timer running every two minutes:

```ini
# ~/.config/systemd/user/hearth-snapshot.timer
[Unit]
Description=Snapshot Genkan's working tree every two minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=30s
[Install]
WantedBy=timers.target
```

with a matching `hearth-snapshot.service` of `Type=oneshot` running
`tools/worktree-snapshot.sh save`. This is a developer safety net, not part of
what a family runs.

---

## kidnet-health

```
kidnet-health [--json] [--details] [--quiet] [--wait <seconds>] [--write <file>]
```

Answers one question: is this household's internet working, and is Genkan doing
its job. It is the command a parent runs at 9pm when a child says the internet
is broken, and it is what `kidnet-upgrade` trusts when it decides whether an
upgrade worked.

**Read only.** It writes nothing except the optional JSON cache. That is a rule
rather than a habit: it gets run when things are already going wrong, and a
diagnostic that changes state can make things worse. It needs no root.

What it checks, in this order:

| Check | Fails when |
|---|---|
| the gateway container | `hearth-gw` is not running, so nobody has internet |
| the filter and address server | `hearth-adguard` is not running, so nothing resolves and no device gets an address |
| the children's page | `hearth-portal` is not running |
| the speed test | `hearth-speedtest` is not running. A note, never a failure: it is optional |
| the firewall | table `inet kids` is missing, or any of the chains `input`, `forward`, `metering`, `prerouting`, `postrouting`, or the sets `kids_block`, `kids_allow`, `kids_known` |
| name lookups | a real DNS question, put on the wire to the resolver inside the island, gets no usable answer |
| the children's page answers | an HTTP request to the portal on the island does not come back 200 |
| the network card | `kids0` is not present inside the gateway, so there is no island at all |
| the records | the database cannot be read as `kids_agent` |
| the safety net | `always_allow` has no `scope='safety'` rows, **or** the live `kids_allow` set is empty. Both, because a row in the database and an address in the firewall are two different facts and only the second one saves anybody |
| the background jobs | any enabled `kids-*.timer` has stopped, so time silently stops being counted |
| the Tor relay list | it is more than seven days old. A note, never a failure |

The DNS and portal probes run inside the gateway's network namespace, because
from the host there is no route to either. They use `python3`, which is already
in the gateway image.

Exit code 0 when nothing a household depends on is broken (notes are allowed),
1 otherwise. That binary answer is deliberate: an upgrade has to decide.

`--wait <seconds>` re-checks until it passes or the time runs out, which is how
`kidnet-upgrade` gives containers a moment to come up after a deploy.
`--json` prints the same thing as JSON, which is what the dashboard footer
reads. `--details` spells out what each line actually checked.

What it cannot tell you: that your broadband is up, that a child's laptop is on
the right wifi, or that the filtering caught everything. It says so in its own
output.

---

## kidnet-upgrade

```
kidnet-upgrade [check]
sudo kidnet-upgrade apply [--to <ref>] [--yes] [--dry-run] [--allow-dirty]
                          [--no-auto-rollback] [--wait <seconds>]
kidnet-upgrade status
```

Updates Genkan. `check` (the default) changes nothing: it fetches, says what is
available, lists what changed, and calls out separately if the release touches
the database.

`apply` does this, stopping at the first failure:

1. Checks the **new** version in a throwaway git worktree, while the household
   carries on: `nft -c` on the new ruleset, `test/schema-test.sh` on the new
   schema, `bash -n` on every new script. A failure here means nothing is
   changed and the household never notices.
2. Snapshots into `/var/lib/hearth/releases/<timestamp>/`: a `pg_dump` of the
   database, a `manifest.env` naming the commit to come back to, and a copy of
   `kidnet-rollback`, `kidnet-health` and the shared library. The undo tool
   travels with the thing it undoes, because a version broken enough to fail
   its health check cannot be trusted to roll itself back.
3. Switches the checkout over and runs `deploy.sh`.
4. Runs `kidnet-health --wait`. If it fails, it calls the snapshot's own copy
   of `kidnet-rollback` and puts the old version back, unasked.

Follows release tags (`v[0-9]*`), not branches, so a household never receives
the tip of main unless somebody types `--to origin/main`.

Safe to run twice: an upgrade to the version already installed says so and does
nothing. Safe to interrupt: a killed run leaves `/var/lib/hearth/releases/in-progress`,
and the next run finishes that job or rolls it back rather than starting a new one.

Refuses to run over uncommitted edits unless `--allow-dirty`, and snapshots them
with `tools/worktree-snapshot.sh` either way.

`status` prints the version, the snapshots available, and the last ten rows of
the release log.

Overridable for testing, which is how `test/release-test.sh` drives the whole
path without going near a live household: `HEARTH_ROOT`, `HEARTH_STATE_DIR`,
`HEARTH_DB`, `PG_CONTAINER`, `HEARTH_APPLY_CMD`, `HEARTH_HEALTH_FILE`,
`HEARTH_KEEP_SNAPSHOTS`.

---

## kidnet-rollback

```
kidnet-rollback list
kidnet-rollback show <id>
sudo kidnet-rollback to <id|previous> [--with-database] [--yes] [--dry-run]
```

Goes back to a version that worked, deliberately. `list` shows every snapshot,
when it was taken, which version it goes back to, and whether it has a database
backup.

`to` puts the code back and re-runs `deploy.sh`, then checks the household. It
leaves the database alone unless you pass `--with-database`, which replaces the
database with the copy in the snapshot and makes you type `ROLLBACK` in full
first. It takes a copy of what it is about to replace before it does.

The limits are documented at length in [UPGRADING.md](UPGRADING.md) and in the
script's own header. The short version: a restore is a restore, so everything
since the snapshot is gone, including minutes children earned. A rollback
cannot undo a dropped database column on its own, and a release that drops one
needs `--with-database` on the way back.

---

## The test suites

Not in `bin/`, but part of the same surface. All nine need the stack or at
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

    sudo test/firewall-test.sh        46 checks: the shipped ruleset, real packets, three namespaces
    sudo test/container-test.sh       26 checks: the real image, containment, replug, segment guard
    sudo test/roles-test.sh          108 checks: the household roles, who each scope reaches, and the 11pm scenario
    sudo test/release-test.sh         42 checks: an upgrade, a failed upgrade, and getting back off it
    sudo test/iot-policy-test.sh      39 checks: the household IoT policy, real packets, six namespaces
    sudo test/meter-test.sh            8 checks: category minutes, budget enforcement, grant
    sudo test/service-meter-test.sh    6 checks: per-service bytes, active minutes, idle ignored
    test/schema-test.sh               88 checks: a fresh install, every schema file into an empty database
    test/db-role-test.sh              77 checks: the CLI's role cannot leave the database it is given
    test/schedule-test.sh             57 checks: bedtimes, the morning restore, and who may lift what
    test/notify-test.sh               41 checks: what may reach a phone, and what may never reach a lock screen
    test/package-test.sh              31 checks: a community learning package treated as hostile input
    test/alerts-test.sh               15 checks: a flagged domain raises one alert, and a broken check says so
    test/tor-test.sh                  25 checks: the relay list reaches the firewall, and says so when it does not
    ADGUARD_PASS=... test/adguard-test.sh    9 checks: the DNS layer, via AdGuard's own check_host API

Run them one at a time. Several build a throwaway database or a namespace with
a fixed name, so two at once collide and report failures that are not real.

`container-test.sh` skips one containment check when the interim
`hearth-share-gateway` service is running, because that service adds host NAT
for the island subnet on purpose.

The ones that do not need root: `schema-test.sh`, `db-role-test.sh`,
`schedule-test.sh`, `notify-test.sh`, `package-test.sh`, `alerts-test.sh`,
`tor-test.sh` and `adguard-test.sh`.
`adguard-test.sh` is the only one that needs the island profile up.

`schema-test.sh` creates a throwaway database, loads every file through
`config/db/load.sh` in order, asserts the tables, views and defaults a fresh
install must have, and drops it again. It touches nothing that is running. It
exists because every other suite runs against this box's database, which was
built up over months, so none of them would ever catch a documented load order
that no longer works. That had already happened: a stranger's first install
failed on the first two files.

`schedule-test.sh` never touches the household database. It creates its own,
loads the real schema files into it, invents a family, and points
`bin/kidnet-schedule` and `bin/genkan` at that database with `HEARTH_DB`. The
firewall is pointed at a container that does not exist, so nothing in it can
reach nftables either. It proves the time maths at fixed moments, then drives
the worker through a bedtime, a parent override, a restart mid-bedtime and a
morning restore.

`roles-test.sh` needs root only for a network namespace: it builds its own copy
of the `kids_block` set in there rather than writing to the live gateway, so it
is safe to run on a household that is in use. It creates its own people and
devices, asserts, then deletes them and puts the category blocks it touched back
exactly as it found them.

After any change to `config/nftables/kids.nft`, `gateway/` or `bin/genkan`, run
the firewall and container suites. Both must pass fully. After any change to
`config/db/`, run the schema suite.

`release-test.sh` proves the upgrade and rollback path without touching
anything real. It clones the repo into a temp directory, invents two releases
in it, points `HEARTH_ROOT`, `HEARTH_STATE_DIR`, `HEARTH_DB`,
`HEARTH_HEALTH_FILE` and `HEARTH_APPLY_CMD` at throwaways, then upgrades,
breaks the health check on purpose and checks that the tooling put the old
version back by itself. Run it with sudo: without root, `kidnet-upgrade`
refuses to apply anything, and that refusal is itself one of the things worth
keeping. Run it before cutting any release.
