# Running a Genkan box

Day two. The island is deployed and the family is on it. This is how you check
it is healthy, read what it is telling you, and fix the handful of things that
actually go wrong.

Every command here is real and runs against this repo. Where a command needs
`sudo` it says so. Nothing in this file changes policy: for that, see
[CLI.md](CLI.md).

---

## Is it healthy?

One command, about five seconds, and it is the one to reach for first:

    kidnet-health            # everything below, in plain language, with an exit code
    kidnet-health --details  # and what each line actually checked

It is read only and needs no root, so it is safe on a household in use and
safe to run as often as you like. It checks the three containers, the firewall
chains and sets, a real DNS query and a real HTTP request from inside the
island, the database, the safety net in both the database and the live
firewall, the background timers and the age of the Tor relay list. Exit 0 means
nothing a household depends on is broken. See docs/CLI.md for the full list and
for what it deliberately cannot tell you.

The version is its first line, and the same line sits at the bottom of every
dashboard page. If something broke after an update, docs/UPGRADING.md is the
next thing to read.

The four checks below are what `kidnet-health` automates, and they are still
worth knowing by hand for the day it is the thing that is broken.

Four checks, about thirty seconds.

    docker ps --filter name=hearth                 # gateway, adguard, portal, speedtest: all Up
    docker logs --tail 20 hearth-gw                # the gateway's own account of itself
    genkan allow-status                            # the safety net and reading list have addresses in them
    systemctl list-timers 'kids-*'                 # six timers, all waiting, none failed

Healthy gateway logs look like this:

    [gateway] 2026-08-29T03:07:29Z segment guard: no competing DHCP/DNS server on this wire, safe to own it
    [gateway] 2026-08-29T03:07:30Z firewall loaded
    [gateway] 2026-08-29T03:07:30Z reconciled kids_known -> 20 address(es)
    [gateway] 2026-08-29T03:07:31Z safety net: 16 addresses loaded
    [gateway] 2026-08-29T03:07:31Z ALERT(info): island is UP on kids0 (192.168.60.1/24)

A `reconciled` line is meant to appear only when the desired state actually
changed. On the current image it appears every fifteen seconds regardless,
because the entrypoint reads the existing nft set with python3 and python3 is
not installed in the gateway image, so the "has anything changed" comparison
never matches. The rewrite is idempotent and the island is fine; the logs are
just noisier than they should be. Tracked in DECISIONS.md.

Then the deeper checks, when you have changed something or you want proof
rather than reassurance:

    sudo test/firewall-test.sh          # 46 checks, throwaway namespaces, no hardware
    sudo test/container-test.sh         # 26 checks, the real image, containment proven
    test/schema-test.sh                 # 88 checks, a fresh install into an empty database
    test/db-role-test.sh                # 77 checks, the CLI's role cannot leave the database
    test/alerts-test.sh                 # 15 checks, the safety alert path runs
    test/tor-test.sh                    # 25 checks, the relay list reaches the firewall
    ADGUARD_PASS=... test/adguard-test.sh

docs/CLI.md lists all fifteen suites. Run them one at a time: several build a
throwaway database or a namespace with a fixed name, so two at once collide and
report failures that are not real.

The container suite is the one to run after any change to the firewall, the
gateway or `genkan`. It builds the real image, hands it a fake NIC the same way
the host warden does, and attacks it from a fake kid device.

### What the parent sees

The admin dashboard is a Node process on the **host**, deliberately outside the
island, bound to your private network (Tailscale in the reference setup):

    systemctl --user status kids-dashboard      # if you run it as a user unit
    curl -s localhost:8899/ >/dev/null && echo dashboard ok

Server-rendered pages, so they work with JavaScript off (the controls need it,
the charts and numbers do not). The authoritative list is the header comment at
the top of `dashboard/server.mjs`, because this is the part of the project that
moves fastest. At the time of writing:

| Page | What it is for |
|---|---|
| `/` | tonight's state and the controls |
| `/live` | Right Now: live traffic over SSE, filterable by person and device class |
| `/family` | add, edit and remove people; rename and reassign devices |
| `/week` | the weekly digest, with a plain-text version to send |
| `/trends` | per-child usage, services, and the earn versus spend balance |
| `/earn` | Learn to earn: the jobs on offer per child, every quiz bank with its pass rate and its worst questions, writing and editing your own banks, the rules of earning, badges, and the switch for the household board |
| `/devices` | the roster and the naming queue |
| `/system` | the health of the box itself |
| `/speed` | the island speed test, proxied from the gateway |
| `/kid/<name>` | one child |

**`/system`** reads CPU, memory, disk, load, uptime, temperature and the Genkan
containers straight out of `/proc`, `/sys` and `statfs`. Nothing shells out to
`top`, `df` or `free`, because a family box can be a Raspberry Pi. It runs on
its own slow SSE stream (`/api/system/stream`, one sample every ten seconds,
three hours held in memory) rather than on the live wire, which samples the
family network every 1.5 seconds and only runs while somebody has Right Now
open. `/api/system.json` returns the same sample as JSON if you want to script
against it. Nothing from this page is written to the database, and the page
renders before Postgres is consulted, so it still works when the database is the
thing that is broken. Any metric it cannot read shows as "n/a" with a reason
rather than as a zero. `HEARTH_SYS_TICK_MS` (default 10000, clamped to 2000 to
60000) changes the sample interval.

**`/speed`** proxies the speed test that runs inside the gateway container.
The test has to run there, because the gateway is the only machine that can see
the family wifi from the inside, but its own address is on the island and a
parent reading the dashboard is on the other side of it. The dashboard sits on
both sides, so it proxies rather than publishing a second port. The gateway's
address is asked of docker rather than hardcoded, and looked up again on any
connection failure. If the page says the speed test is not answering, check that
the `hearth-speedtest` container is up. Note what it measures through the
dashboard: this device to the box over whatever network you are on, which is
**not** the family wifi. The bar on the page says so.

`config/systemd-user/hearth-dashboard.service` is an example unit, not an
installed one: `deploy.sh` does not touch it, because where the dashboard binds
is household-specific and getting that wrong publishes a panel that can switch a
child's internet off. Copy it to `~/.config/systemd/user/` and edit the paths and
the bind address, or write your own from this:

```ini
[Unit]
Description=Genkan admin dashboard
After=network-online.target

[Service]
WorkingDirectory=/path/to/hearth/dashboard
EnvironmentFile=/path/to/hearth/secrets.env
Environment=BIND=<your tailnet address>
Environment=PORT=8899
# Optional: require a shared secret on every /api/* call, for defence beyond
# the tailnet perimeter. The page injects it from a same-origin cookie.
# Environment=DASH_TOKEN=<a long random string>
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now
kids-dashboard`. If you want it to survive a logout, `loginctl enable-linger
$USER`.

---

## What each piece does, and when

### The containers

| Container | What it holds |
|---|---|
| `hearth-gw` | the network namespace, `kids0`, the whole nftables ruleset, and the supervisor loop |
| `hearth-adguard` | DHCP, DNS and filtering, sharing the gateway's namespace |
| `hearth-portal` | the kids' captive portal and quiz engine, same namespace, on port 80 |
| `hearth-speedtest` | the island speed test, same namespace, on port 8877. Reachable directly by any device on the island, and proxied to the admin side by the dashboard at `/speed` |

The portal and AdGuard join the gateway with `network_mode: service:gateway`.
That is why a bad firewall rule can take the island down but cannot touch the
host, the main LAN or your VPN: those interfaces do not exist inside that
namespace.

The gateway supervisor is a loop, not a one-shot. It waits for the warden to
hand it `kids0`, runs the segment guard, configures the address, loads the
firewall, syncs state from the database, then reconciles every fifteen seconds
and re-resolves the safety net every hour. If `kids0` vanishes (a USB replug) it
raises a warning and starts the whole sequence again when it returns.

### The host-side units

One service and seven timers. That is the entire host footprint, besides the
`genkan` scripts in `/usr/local/bin` and `/etc/kids-network/`.

| Unit | Cadence | What it runs |
|---|---|---|
| `kids-nic-warden.service` | always on | hands the kids' USB NIC into the gateway container, and re-does it after replugs, container restarts and Docker daemon restarts |
| `kids-meter.timer` | every minute | `kidnet-meter`: ticks a minute off each active child's daily budget |
| `kids-metering.timer` | every minute | `kidnet-catmap` then `kidnet-catmeter`: learn category addresses, count active minutes, enforce category budgets |
| `kids-services.timer` | every minute | `kidnet-servicemap` then `kidnet-servicemeter`: learn service addresses, count real bytes per service |
| `kids-devicescan.timer` | every minute | `kidnet-devicescan`: DHCP leases into the devices table, then `kidnet-classify` |
| `kids-dnslog.timer` | every 2 minutes | `kidnet-dnslog`, then `kidnet-alerts` as an `ExecStartPost` |
| `kids-schedule.timer` | every minute | `kidnet-schedule apply`: puts scheduled bedtimes on, and lifts them in the morning |
| `kids-tor-sync.timer` | daily, with up to 2h jitter | `kidnet-tor-sync sync`: fetches the relay list into the `tor_nodes` table. The gateway rebuilds the nft set from there. |

There is an eighth timer, `kids-iot-policy.timer`. `deploy.sh` installs it and
deliberately does **not** enable it, because the household IoT layer is switched
on by hand after you have watched it in observe mode. See
[HOUSEHOLD-SECURITY.md](HOUSEHOLD-SECURITY.md).

`kids-schedule.timer` is installed **and** enabled, which is the opposite
choice, and for a reason worth saying out loud: the switch there is the data,
not the unit. With no rows in `schedules`, and a fresh install has none, the
worker does nothing at all. The failure to avoid is a parent setting a bedtime
on the dashboard and it silently never running because a timer they have never
heard of was left off. `OnBootSec` is 45 seconds rather than the minutes the
others use, because a box that rebooted at eleven at night has to reassert the
bedtime promptly.

`deploy.sh` applies `config/db/schema-schedule.sql` itself, before the grants,
which is the only schema file it loads on its own. A timer it switches on has to
have the tables it reads, or an existing household that pulled the repo and
deployed would get a worker erroring into the journal every minute and a
dashboard offering a bedtime form that saves nothing. The file is idempotent, so
on a database that already has it this changes nothing. Every other schema file
still goes through `config/db/load.sh`.

On a box where the tables are genuinely missing, `genkan schedule show` and the
worker both say so in one sentence and exit 0 rather than printing a psql trace
sixty times an hour.

To stop bedtimes without uninstalling anything:

    genkan schedule disable <kid>        # one child, keeps their times
    genkan schedule holiday clear        # end every override window
    sudo systemctl disable --now kids-schedule.timer   # the whole thing

Disabling the timer leaves whatever is currently blocked blocked, because
nothing is left to lift it. Turn the child back on by hand (`genkan on <kid>`)
before you disable it, or use `genkan schedule clear <kid>`, which lifts what it
was holding as it goes.

The timers stagger their first run after boot (60s, 90s, 2min, 3min) so they do
not all wake at once while the stack is still coming up.

To see what one of them last did:

    systemctl status kids-metering.service
    journalctl -u kids-services.service --since "30 min ago"
    journalctl -u kids-nic-warden.service -f

There is no timer for the safety net. The gateway container refreshes it itself,
hourly. `genkan allow-sync` exists to force it from the host.

### The weekly digest

`kidnet-report` is not installed by `deploy.sh` and has no timer. If you want it
on a schedule, [reporting.md](reporting.md) has the two units to create.

---

## Reading the logs

**The gateway.** Everything the island does about itself:

    docker logs -f hearth-gw
    docker logs hearth-gw 2>&1 | grep -E 'ALERT|TRIPPED|vanished|FAILED'

The lines worth knowing:

| Line | Means |
|---|---|
| `island is UP on kids0` | serving, healthy |
| `segment guard: ... safe to own it` | the wire was quiet, we took it |
| `segment guard TRIPPED` | someone else is serving this wire, we refused (see below) |
| `segment guard CANNOT LISTEN` | we could not verify the wire, so we failed closed |
| `firewall ruleset failed to load` | the island stays down on purpose |
| `kids0 vanished` | the NIC went away, usually a USB replug |
| `reconciled kids_block -> N address(es)` | a child was switched on or off |
| `safety net: N addresses loaded` | the help lines resolved and are in the firewall |
| `reconcile ... database unreachable, keeping the existing set` | Postgres is down; the firewall holds its last known good state |

**AdGuard.** `docker logs hearth-adguard`, or its web UI on the host's loopback
at `http://127.0.0.1:8853` (published loopback-only on purpose; reach it over
your tailnet by tunnelling to the host, never from the island).

**The alerts table** is the thing to read rather than logs, because it is where
the gateway, the meter and `kidnet-alerts` all converge:

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT ts, severity, category, domain, detail FROM alerts
       WHERE NOT acknowledged ORDER BY ts DESC LIMIT 20"

The gateway acknowledges its own `category='gateway'` alerts when it comes up
healthy, so the dashboard stops showing a solved problem as if it were still
happening.

**Two categories are alerts about Genkan rather than about a child**, and both
mean the safety path has stopped working:

| Category | What it means |
|---|---|
| `dns-ingest` | the query log is not reaching the database, so nothing can be checked |
| `alert-check` | the log is arriving but the check over it failed to run |

Either one means no flagged look-up is being noticed. Both retire themselves on
the next good run, so an unacknowledged one is a live problem, not history.
After fixing one, sweep the window you lost rather than waiting for the timer:

    ALERT_LOOKBACK="2 days" kidnet-alerts

They exist because the failure of a safety check has no symptom of its own. No
alerts is what a good night looks like, so silence had to be made to mean
something. See DECISIONS.md, "A check that cannot run must never look like a
quiet night".

---

## Is the metering chain actually learning?

Per-category metering is a chain of four links, and a break anywhere in it looks
identical from the dashboard: the charts simply say "other". Walk the chain in
order, and stop at the first number that is zero.

**1. Is there a domain map at all?** This is the one that catches a fresh
install. `category_domains` and `service_domains` come from
`config/db/schema-categories.sql` and `config/db/schema-services.sql`. Before
2026-08-29 neither file carried a seed: the reference box had about forty rows
typed in by hand, and a fresh install had none at all, so it metered nothing and
said so by drawing everything as "other".

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT category, count(*) FROM category_domains GROUP BY 1 ORDER BY 1"

Expect roughly 175 rows across `gaming`, `video`, `social`, `audio`,
`download`, `messaging` and `schoolwork`. Zero means the schema files have not
been loaded since the seed landed: load `schema-categories.sql` and
`schema-services.sql` again, they are idempotent.

**2. Is the mapper turning lookups into addresses?**

    sudo systemctl start kids-metering.service
    journalctl -u kids-metering.service --since "10 min ago"
    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT category, count(*) FROM category_ips
        WHERE seen > now() - interval '24 hours' GROUP BY 1 ORDER BY 1"

`kidnet-catmap` reads AdGuard's query log, so it needs `ADGUARD_PASS` and it can
only learn from names the family has actually looked up. A category nobody used
today is legitimately empty. A count that is zero across the board usually means
AdGuard authentication is failing: check `secrets.env`.

Some emptiness here is by design. The mapper drops any address that answered for
more than one category, or for anything uncategorised, and never learns from a
bare apex lookup. That is the guard that stopped one shared Google edge address
colouring the whole house's traffic as video, and the honest cost is that a
category can read low. METERING.md explains it in full.

**3. Are those addresses reaching the firewall?**

    docker exec hearth-gw nft list set inet kids gaming_ips | head
    docker exec hearth-gw nft list set inet kids video_ips | head
    docker exec hearth-gw nft list set inet kids download_ips | head

`kidnet-catmeter` reconciles these every minute: it flushes and refills each set
in one transaction, so what is in the firewall is exactly what was in
`category_ips` at the last tick. If the sets are empty while step 2 has rows,
the meter is not reaching either the database or the container: run it by hand
and read what it says. If `download_ips` does not exist at all, the gateway is
running a ruleset from before the download category; the meter creates the set
and its counting rule itself on the next tick, so this heals on its own.

**4. Are minutes being booked?**

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT day, category, sum(minutes) FROM category_usage
        WHERE day = CURRENT_DATE GROUP BY 1,2 ORDER BY 2"

A device has to move more than the per-category threshold inside a minute to
count, so idle keepalive books nothing. `download` will appear here and is
deliberately never enforced against a budget.

---

## Turning device claiming on, and off again

Off by default, and it stays off until you change one row. The full reasoning is
in [DEVICE-IDENTITY.md](DEVICE-IDENTITY.md); this is the operational half.

    genkan claim-mode                    what mode it is in, and how many devices are unclaimed
    genkan claim-mode observe            watch first: nothing is restricted
    genkan unclaimed                     what enforcing would catch
    genkan claim-mode enforce            switch it on
    genkan claim-mode off                switch it back off

**Always run `observe` for a few days first.** It restricts nothing and just
tells you the truth: how many personal devices in your house belong to nobody.
On a household that has been running a while that number is usually higher than
expected, because every guest phone, every device from before you started naming
things, and every console somebody plugged in counts. Enforcing without looking
first is how a family wakes up to three broken devices and no idea why.

In `enforce`, an unclaimed device gets DNS, the captive portal and the safety
net, and nothing else. It is not off the network: it lands on the claim page.
The enforcement is the `kids_unclaimed` nft set, reconciled from the
`unclaimed_devices` view on the gateway's usual fifteen second tick, so switching
the mode takes effect within a tick and needs no restart:

    docker exec hearth-gw nft list set inet kids kids_unclaimed

Smart home kit, appliances and infrastructure are never expected to announce
themselves and never appear in that set. Only `category='personal'` devices do.

A child claiming a device at the portal gains nothing on its own. The device is
marked `claim_pending` and **stays restricted** until a parent agrees:

    genkan claims                        what is waiting
    genkan confirm <device|address>      say yes

`confirm` clears the pending flag and re-runs `kidnet-adguard-clients`, so the
device picks up its owner's filter tier and clock straight away. The same queue
and the same button are on the dashboard.

If it goes wrong, `genkan claim-mode off` is the whole undo. Nothing is deleted
and no device has to be re-claimed later, because the claims themselves are kept.

---

## Is the reading list reaching the firewall?

The reading list is the `scope='learn'` rows in `always_allow`: around forty
reference sites a child can still reach when they have run out of time. They go
into the same `@kids_allow` nft set as the safety net, because the firewall
matches addresses and does not care why an address is allowed.

Three checks, in order:

    # 1. Are the rows loaded at all? Expect roughly 40.
    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT category, count(*) FROM always_allow WHERE scope='learn' GROUP BY 1 ORDER BY 1"

    # 2. Did they resolve? This prints the count it installed.
    genkan allow-sync

    # 3. Are they in the firewall?
    genkan allow-status

Zero rows in step 1 means `config/db/schema-learn.sql` and
`config/db/schema-learn-intl.sql` have not been loaded. Both are idempotent, so
load them again.

The set is one flat list of addresses, so `allow-status` cannot tell you which
address came from which scope. To check one site end to end, resolve it and look
for the address:

    getent ahostsv4 wikipedia.org | awk '{print $1}' | sort -u
    genkan allow-status | tr ',' '\n' | grep -F "$(getent ahostsv4 wikipedia.org | awk 'NR==1{print $1}')"

**These are CDN-hosted and the addresses move.** That is why the gateway
re-resolves the whole set hourly rather than at boot only. A site that "worked
yesterday and not today" for a child who is out of time is almost always this,
and `genkan allow-sync` fixes it immediately. `allow-sync` refuses to install an
empty result, so a resolver blip leaves yesterday's addresses in place rather
than leaving a cut-off child with nothing.

The honest limit: a site whose addresses change faster than an hour, or which
answers with a different address per client, can drop out of the list between
refreshes. Adding a domain is a database row and a re-sync:

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "INSERT INTO always_allow (domain, scope, category, note)
       VALUES ('example.org', 'learn', 'reference', 'why you added it')
       ON CONFLICT (domain) DO NOTHING"
    genkan allow-sync

Read the five tests in [READING-LIST.md](READING-LIST.md) before you add one.
The list only works while it stays dull.

---

## The working-tree snapshot (development boxes only)

`tools/worktree-snapshot.sh` commits the entire working tree, tracked and
untracked, to `refs/hearth/snapshots` every couple of minutes. It exists because
one `git checkout` discarded an agent's uncommitted work and there was nothing to
recover from.

**A family running Genkan does not need this.** It is for a box where somebody,
or something, is editing the repo. Nothing in `deploy.sh` installs it and no
household unit refers to it.

    tools/worktree-snapshot.sh list
    tools/worktree-snapshot.sh show <ref>
    tools/worktree-snapshot.sh restore <ref> path/to/file

The timer is not in the repo, for the same reason the dashboard's is not: how
often you want it is not Genkan's business. On the reference box it is a user
timer (`hearth-snapshot.timer`) firing every two minutes, with a `Type=oneshot`
service running `tools/worktree-snapshot.sh save`. `docs/CLI.md` has the unit.

    systemctl --user list-timers hearth-snapshot.timer
    journalctl --user -u hearth-snapshot.service --since "1 hour ago"

It uses its own git index file, so it never disturbs what you have staged, and it
skips the commit entirely when nothing has changed. The ref is local and is never
pushed.

## The public demos

On the reference box, two public demos are the only part of Genkan reachable
from the internet. Neither can touch the household, and a household install runs
none of this.

| Demo | What it shows |
|---|---|
| `demo.genkan.nz` | the parent's dashboard |
| `quiz-demo.genkan.nz` | the child's captive portal and the quizzes |

Both run the **real** code: `demo/compose.yaml` bind-mounts `../dashboard` read
only and runs the same `server.mjs` and `portal.mjs` a household runs, against a
throwaway Postgres full of an invented family. There is no second copy of
anything, so improving the dashboard improves the demo. What makes it inert is
listed in `demo/README.md` and none of it is a matter of trust: its own database
on its own network, no docker socket mounted, `bin/` not mounted, no
`NET_ADMIN`, and `HEARTH_DEMO=1`, which replaces every path that would shell out
with a function that returns a polite refusal before `execFile` is reached.

Restarting and re-seeding:

    systemctl --user restart hearth-demo.service        # or: docker compose -f demo/compose.yaml up -d
    docker compose -f demo/compose.yaml ps
    docker compose -f demo/compose.yaml logs -f demo-dashboard

    demo/reseed.sh                                      # rebuild the demo database now
    systemctl --user start hearth-demo-reseed.service   # the same thing, logged

`hearth-demo-reseed.timer` runs the reseed at about 03:40 nightly. Every
timestamp in `demo/seed.sql` is relative to `now()`, so a nightly rebuild keeps
the charts showing the last six weeks rather than the six weeks before whenever
it was last touched, and it puts back anything a visitor changed. It drops the
schema first, because the repo's schema files are individually idempotent but
the whole set is not re-runnable over itself.

After a change to `dashboard/*.mjs`, restart the container. After a change to
`config/db/schema*.sql`, re-seed as well:

    docker compose -f demo/compose.yaml restart demo-dashboard demo-portal
    demo/reseed.sh

The units (`hearth-demo.service`, `hearth-demo-reseed.service` and `.timer`)
live on the box rather than in the repo, the same way `kids-dashboard.service`
does, because where a demo is published is not a household concern.

---

## "The segment guard refused to start"

You will see this in the gateway log:

    ALERT(urgent): segment guard TRIPPED on kids0: another DHCP or DNS server
    is serving this wire (...). Refusing to start: is the access point still
    bridged to the main network?

**This is the system working.** Before serving anything, the gateway listens on
`kids0` for eight seconds. If it hears another DHCP server answering, or DNS
traffic sourced from a subnet that is not ours, it refuses to become the
gateway rather than fight your real router. It retries every sixty seconds.

Almost always the cause is one of these:

1. **The access point is still in router or mesh mode**, and is bridging your
   main house network onto the kids' port. This is the exact event the guard was
   built for. Factory reset it, set it up as a standalone network, then switch
   it to Access Point or bridge mode. Its own DHCP and NAT must be off.
2. **The kids' cable is plugged into the wrong port**, so `kids0` is looking at
   your main LAN.
3. **A second DHCP server** on the island: an old router someone plugged in, or
   a switch with DHCP enabled.

To see what it heard, from the host:

    sudo tcpdump -i <the kids NIC> -nn -c 20 'udp src port 67 or udp src port 53'

The other failure mode is:

    ALERT(urgent): segment guard CANNOT LISTEN on kids0 (tcpdump rc=...)

That means the guard could not prove it was listening, so it failed closed
rather than assume silence meant safety. Check that `tcpdump` exists in the
gateway image and that `NET_RAW` is still in the container's capabilities. This
failure mode is in the code because it happened for real: `tcpdump` died
instantly on a missing capability and a silenced error made that look like a
quiet wire.

Note that the guard deliberately does **not** trip on client ARP for a foreign
subnet. A device holding a stale lease from the old network broadcasts exactly
that, it is harmless, and it renews onto our subnet within minutes.

---

## "A device is not getting internet"

Work down this list. It is ordered by how often each one is the answer.

**1. Is it out of time, or is a category blocked?**

    genkan time <kid>
    genkan status

If it is out of time, the device should be seeing the captive portal, not a dead
connection. `genkan bonus <kid> 15` reopens it.

**2. Does it have a lease, and is it a known device?**

    genkan leases
    genkan devices
    docker exec hearth-gw nft list set inet kids kids_known

The island is default-deny by source address. A device only gets internet if its
address is in `kids_known`, which is every active DHCP reservation plus every
current lease, reconciled from the database every fifteen seconds. **A device
with a hand-set static address outside its reservation gets nothing.** That is
deliberate: it closes the static-IP dodge, and it is one of the checks in the
container suite.

If a genuinely new device is stuck, it is usually because the lease has not
reached the database yet. `kidnet-devicescan` runs every minute, and the gateway
also reads AdGuard's leases directly to close that gap. Force it:

    sudo systemctl start kids-devicescan.service
    docker logs --tail 5 hearth-gw          # look for kids_known going up

**3. Is it actually blocked?**

    docker exec hearth-gw nft list set inet kids kids_block

If an address is in there and the database disagrees, wait fifteen seconds: the
gateway reconciles from the database, and the database wins. If it does not
clear, Postgres is probably unreachable from the container, and the log will
say so.

**4. Is it an IoT device you have accidentally treated as personal?**

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "SELECT label, hostname, mac, kind, category FROM device_roster ORDER BY category"

Group commands only touch `category='personal'`. If your camera has been
classed personal and went dark at bedtime, reclassify it:

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "UPDATE devices SET category='iot', kind='camera' WHERE mac='aa:bb:cc:dd:ee:ff'"

**5. Is the island up at all?**

    docker logs --tail 5 hearth-gw
    docker exec hearth-gw ip addr show kids0

No `kids0` inside the container means the warden has not handed it over.
`systemctl status kids-nic-warden` and check the dongle is plugged in and that
`KIDS_NIC_MAC` in `config.env` matches it.

**6. Is DNS the problem rather than the firewall?**

Every port 53 query from the island is redirected to our resolver, and DoT and
known DoH endpoints are refused. If a device has "Private DNS" set to a specific
hostname (not "automatic"), Android will refuse to fall back and the device
looks offline while the network is fine. Set Private DNS to Off or Automatic.
That is bug bounty level 2, and it is worth telling the kid so.

---

## "A child's internet did not come back this morning"

The morning restore matters more than the bedtime, so this is the failure to
check for first. In order:

**1. Is anything actually blocked, and who put it there?**

    genkan status
    docker exec -i postgres psql -U kids_agent -d kids_network -tAc \
      "SELECT c.name, cs.category, cs.blocked, cs.set_by, cs.since
         FROM category_state cs JOIN children c ON c.id=cs.child_id WHERE cs.blocked"

`set_by` is the whole answer:

- `bedtime` and it is the morning: the worker has not run. Check the timer.
- `agent`: somebody turned it off by hand. A schedule will never lift that, by
  design. `genkan on <kid>`.
- `out-of-time`: they have used the day's minutes. `genkan bonus <kid> <min>`,
  or they earn it back on the portal.
- `over-budget` on one category: that category hit its daily cap.
  `genkan grant <kid> <gaming|video> <min>`.

**2. Is the timer running?**

    systemctl status kids-schedule.timer
    journalctl -u kids-schedule.service --since "12 hours ago"

The worker is quiet unless something changed, so an empty journal overnight
means nothing needed doing, not that it did not run. `systemctl list-timers
kids-schedule.timer` shows when it last fired.

**3. What does it think tonight looks like?**

    genkan schedule show
    genkan schedule show <kid>

That prints the bedtimes, what is in force right now, when it lifts, and any
holiday window. If the times are right and the child is still blocked, run
`kidnet-schedule apply` by hand and read what it says.

**4. Is the database on the household's clock?**

    docker exec -i postgres psql -U postgres -tAc "SHOW timezone" -d kids_network

A bedtime is a local-time idea. If that says UTC, the day boundary and the
bedtime are both twelve hours out. `deploy.sh` sets it from `HEARTH_TZ` in
`config.env`.

**5. Did the firewall follow?** The block is a row; the gateway rebuilds the
firewall from it every 15 seconds. If the database says unblocked and the child
is still off, that is a reconcile problem, not a schedule problem:

    docker logs hearth-gw 2>&1 | grep reconcile | tail

---

## Rotating the AdGuard password

`deploy.sh` generates a real password on first deploy, writes the plaintext to
`secrets.env` and seeds the bcrypt hash into `config/adguard/AdGuardHome.yaml`.
After that, AdGuard owns its own config inside a Docker volume and rewrites it
itself, so rotation is a two-place change.

    # 1. A new password.
    NEW=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)

    # 2. Hash it. AdGuard wants $2a or $2b bcrypt; httpd emits $2y, so normalise.
    HASH=$(docker run --rm httpd:2.4-alpine htpasswd -nbBC 10 admin "$NEW" | cut -d: -f2)
    HASH="${HASH/\$2y\$/\$2b\$}"

    # 3. Put the hash in AdGuard's LIVE config, inside its volume.
    docker exec hearth-adguard sh -c \
      "sed -i 's|^\( *password: \).*|\1$HASH|' /opt/adguardhome/conf/AdGuardHome.yaml"

    # 4. Put the plaintext in secrets.env, which is what the genkan tools read.
    sed -i "s|^ADGUARD_PASS=.*|ADGUARD_PASS=$NEW|" secrets.env

    # 5. Restart AdGuard and re-run the timers' next tick.
    docker compose --profile island restart adguard
    ADGUARD_PASS="$NEW" bin/kidnet-adguard apply

Then check it took:

    curl -fsS -u "admin:$NEW" http://127.0.0.1:8853/control/status >/dev/null && echo ok

Two things worth knowing. The seed file `config/adguard/AdGuardHome.yaml` is
copied into the volume only on first boot and never read again, so editing it
later changes nothing on a running box. And `secrets.env` is gitignored and
holds the plaintext: it is the file to protect, and the file to update if you
ever restore a backup onto different hardware.

---

## "genkan says permission denied for table ..."

Since 2026-08-30 `bin/genkan` and every `bin/kidnet-*` worker connect as
`kids_agent`, a role with no superuser, no ownership and no DDL, instead of as
the Postgres superuser. `permission denied for table X` means that role has not
been granted what the command needs. Two causes, in order of likelihood.

**The grants have not been applied to this database yet.** Run them. It is
idempotent:

    docker exec -i postgres psql -U postgres -d kids_network -q \
      < config/db/grants.sql

If it prints `ERROR: relation "..." does not exist`, this database is behind the
schema in the repository: run `config/db/load.sh kids_network` first, then the
grants again.

**Somebody added a verb and forgot the grant.** Add one line to
`config/db/grants.sql` naming the table, the narrowest verb list that works, and
which script needs it. Then re-run the file and `bash test/db-role-test.sh`.

To see what the role actually holds:

    docker exec -i postgres psql -U postgres -d kids_network -tAc "
      SELECT c.relname||' : '||string_agg(DISTINCT a.privilege_type,',' ORDER BY a.privilege_type)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN LATERAL aclexplode(c.relacl) a ON a.grantee='kids_agent'::regrole::oid
      WHERE n.nspname='public' GROUP BY c.relname ORDER BY 1"

Do **not** fix this by putting a command back on `-U postgres`, and do not grant
`kids_agent` anything wholesale. The whole point of the role is that a bad
argument in a shell script cannot become `COPY ... TO PROGRAM`, which is command
execution inside the database container on a server this box shares with
unrelated projects. `docs/DATABASE.md` has the full picture, including the three
places that are still on the superuser path on purpose.

### If Genkan shares a Postgres server with other projects

`kids_network` is closed to `PUBLIC`, so no other project's role can open the
household's database. The other direction is not Genkan's to close: Postgres
lets `PUBLIC` connect to a new database by default, so `kids_agent` can open any
database on the server whose owner has not revoked that. It has no rights on any
table anywhere else, so the most it could read is another database's catalogue,
which is table names rather than data. If you want that closed too, it is one
statement per database, and it is **their** database you are changing:

    docker exec -i postgres psql -U postgres -c \
      "REVOKE CONNECT ON DATABASE their_db FROM PUBLIC"

Check first that their application connects as a named role and not as
`PUBLIC`; the database's own owner keeps CONNECT either way. The cleanest
answer, if you have the choice, is to give Genkan a Postgres of its own.

## Backing up and restoring

There are three things worth keeping. Only the first is irreplaceable.

**1. The database.** Children, devices, the time ledger, quiz results, alerts,
the audit trail.

    # Back up (compressed custom format, restorable table by table).
    docker exec postgres pg_dump -U postgres -Fc kids_network \
      > hearth-$(date +%F).dump

    # Restore into an empty database.
    docker exec -i postgres psql -U postgres -c "CREATE DATABASE kids_network"
    docker exec -i postgres pg_restore -U postgres -d kids_network --no-owner \
      < hearth-2026-08-29.dump

A plain-text dump is easier to read and diff, if you prefer:

    docker exec postgres pg_dump -U postgres kids_network | gzip > hearth-$(date +%F).sql.gz

Restoring onto a fresh box, remember the `kids_app` role has to exist before the
grants in the dump will apply:

    docker exec -i postgres psql -U postgres -c \
      "CREATE ROLE kids_app LOGIN PASSWORD 'the-one-in-secrets.env'"

Then put the CLI's role back, or every `genkan` command answers `permission
denied`. This is idempotent and safe to run at any time:

    docker exec -i postgres psql -U postgres -d kids_network -q \
      < config/db/grants.sql

`config/db/grants.sql` creates `kids_agent` if it is missing and re-grants
everything, so it is also the repair for "somebody dropped a grant by hand".
`sudo ./deploy.sh` runs it for you and prints any grant that did not apply.

And re-pin the timezone, or the daily budget rolls over at UTC midnight instead
of yours:

    docker exec -i postgres psql -U postgres -d kids_network -c \
      "ALTER DATABASE kids_network SET timezone = 'Pacific/Auckland'"

**2. `config.env` and `secrets.env`.** Small, gitignored, and the only files
that hold anything household-specific: the NIC MAC, the subnet, the database
URLs and the AdGuard password. Copy them somewhere safe. Without them a rebuild
needs a fresh `deploy.sh`, which is fine, but AdGuard's password and the
database credentials would then need re-syncing by hand.

**3. AdGuard's own config and query log**, in the `hearth_adguard-conf` and
`hearth_adguard-work` Docker volumes. Optional: the query log is already
mirrored into `dns_log` by `kidnet-dnslog`, and the config is regenerated from
the database by `kidnet-adguard apply`. If you want it anyway:

    docker run --rm -v hearth_adguard-conf:/c -v "$PWD:/out" debian:trixie-slim \
      tar czf /out/adguard-conf-$(date +%F).tgz -C /c .

Backups belong on the same principle as everything else here: they are yours,
they hold your children's browsing history, and they should never leave the
house without a good reason.

---

## Routine maintenance

**After changing the firewall, the gateway or `genkan`:**

    sudo test/firewall-test.sh && sudo test/container-test.sh

**After changing anything that talks to the database** (a schema file,
`config/db/grants.sql`, or a `genkan` verb that touches a new table):

    bash test/schema-test.sh && bash test/db-role-test.sh

`db-role-test.sh` builds a throwaway database and then attacks it: it proves
`kids_agent` cannot run `COPY ... TO PROGRAM`, cannot read a server file,
cannot drop or truncate a table, cannot make itself a superuser, and cannot be
reached from off the box; and then that it can still do every read and write
the CLI and the timers need. Both must pass fully before you commit. This is
not ceremony: the two worst bugs this project has had were a ruleset that never
parsed and a safety net that existed only in the database, and both were caught
the day these tests were written.

**One caution if Genkan shares a Postgres server with other projects.**
`db-role-test.sh` and `schema-test.sh` each create a database, use it for a
minute or so, and drop it. If a whole-instance backup enumerates the databases
while one of those exists and then tries to dump it after it has gone,
`pg_dump` fails on a database that no longer exists and the backup run can fail
with it. That has happened on this box. Do not run these two suites during the
backup window, or make the backup skip a database that vanished mid-run. It is
not a Genkan bug and Genkan cannot fix it from here, but it is worth knowing
before it costs somebody a night's backup.

**After changing policy in the database** (a new always_allow row, a renamed
child, a reassigned device):

    genkan allow-sync                 # if you touched always_allow scope='safety'
    bin/kidnet-adguard apply          # re-render the DNS rules from the database
    bin/kidnet-adguard-clients        # re-point the age tiers at the right addresses

**Upgrading AdGuard.** The image is pinned in `compose.yaml` on purpose, and
`config/adguard/INTEGRATION.md` records the exact version its API notes were
verified against. Re-read that document before bumping the pin.

**Restarting things.** The safe order, least disruptive first:

    docker compose --profile island restart adguard    # DNS blips for a second
    docker compose --profile island restart portal     # nobody notices
    docker compose --profile island restart gateway    # the island drops and re-guards

Restarting the gateway re-runs the segment guard, so if the access point has
been fiddled with since the last start, that is when you find out.

**A Docker daemon restart** takes the island down briefly. `restart: unless-stopped`
plus the warden re-handing the NIC covers the recovery, and the firewall is
rebuilt from the database rather than from memory. This is the known trade-off
of choosing Docker, and it is written up in DECISIONS.md.

---

## When it is genuinely broken

The designed worst case is: **the kids are offline and the house is untouched.**
Everything in the architecture serves that. If you are stuck and the family
needs the internet back tonight, the honest fallback is to plug the kids'
access point straight into your main router. You lose every control, nothing
else breaks, and you can debug in the morning.

To take Genkan down cleanly:

    docker compose --profile island down
    sudo systemctl stop kids-nic-warden.service
    sudo systemctl stop 'kids-*.timer'

To bring it back:

    sudo systemctl start kids-nic-warden.service
    docker compose --profile island up -d
    sudo systemctl start 'kids-*.timer'
    docker logs -f hearth-gw

Nothing above touches the host's own firewall, because Genkan never installs
rules there. That is the point of the whole namespace design, and
`container-test.sh` asserts it every run.

## HTTPS for the dashboard

The dashboard has no browser-trusted certificate by default, so browsers show
"Not secure". That is cosmetic on a private network, but it is a poor look when
demonstrating to anyone, and clicking through security warnings is a habit
worth not teaching.

If you use Tailscale, you can have a real certificate in one command:

1. Enable it once, free, in the admin console:
   https://login.tailscale.com/admin/dns -> HTTPS Certificates -> Enable
2. Run `tools/enable-https.sh`

That fetches a Let's Encrypt certificate for your machine's tailnet name,
stands up a Caddy front end on port 8443 that terminates TLS and proxies to
the dashboard, and installs it as a user service. Tailscale renews the
certificate automatically.

The dashboard stays private to your tailnet. It is deliberately NOT published
through a public tunnel: this panel can switch a child's internet on and off,
and that should not be reachable from the internet merely to obtain a padlock.
