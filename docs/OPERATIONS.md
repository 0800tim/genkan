# Running a Hearth box

Day two. The island is deployed and the family is on it. This is how you check
it is healthy, read what it is telling you, and fix the handful of things that
actually go wrong.

Every command here is real and runs against this repo. Where a command needs
`sudo` it says so. Nothing in this file changes policy: for that, see
[CLI.md](CLI.md).

---

## Is it healthy?

Four checks, about thirty seconds.

    docker ps --filter name=hearth                 # gateway, portal, adguard: all Up
    docker logs --tail 20 hearth-gw                # the gateway's own account of itself
    kidnet allow-status                            # the safety net has addresses in it
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

    sudo test/firewall-test.sh          # 31 checks, throwaway namespaces, no hardware
    sudo test/container-test.sh         # 26 checks, the real image, containment proven
    ADGUARD_PASS=... test/adguard-test.sh

The container suite is the one to run after any change to the firewall, the
gateway or `kidnet`. It builds the real image, hands it a fake NIC the same way
the host warden does, and attacks it from a fake kid device.

### What the parent sees

The admin dashboard is a Node process on the **host**, deliberately outside the
island, bound to your private network (Tailscale in the reference setup):

    systemctl --user status kids-dashboard      # if you run it as a user unit
    curl -s localhost:8899/ >/dev/null && echo dashboard ok

Server-rendered pages, so they work with JavaScript off (the controls need it,
the charts and numbers do not). The authoritative list is the header comment at
the top of `dashboard/server.mjs`, because this is the part of the project that
moves fastest. At the time of writing: `/` for tonight's state and controls,
`/week` for the weekly digest with a plain-text version to send, `/trends` for
per-child usage, services and the earn versus spend balance, `/devices` for the
roster and the naming queue, and `/kid/<name>` for one child.

The repo does not ship a systemd unit for the dashboard, because where it binds
is household-specific. A minimal user unit:

```ini
[Unit]
Description=Hearth admin dashboard
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

One service and six timers. That is the entire host footprint, besides the
`kidnet` scripts in `/usr/local/bin` and `/etc/kids-network/`.

| Unit | Cadence | What it runs |
|---|---|---|
| `kids-nic-warden.service` | always on | hands the kids' USB NIC into the gateway container, and re-does it after replugs, container restarts and Docker daemon restarts |
| `kids-meter.timer` | every minute | `kidnet-meter`: ticks a minute off each active child's daily budget |
| `kids-metering.timer` | every minute | `kidnet-catmap` then `kidnet-catmeter`: learn category addresses, count active minutes, enforce category budgets |
| `kids-services.timer` | every minute | `kidnet-servicemap` then `kidnet-servicemeter`: learn service addresses, count real bytes per service |
| `kids-devicescan.timer` | every minute | `kidnet-devicescan`: DHCP leases into the devices table, then `kidnet-classify` |
| `kids-dnslog.timer` | every 2 minutes | `kidnet-dnslog`, then `kidnet-alerts` as an `ExecStartPost` |
| `kids-tor-sync.timer` | daily, with up to 2h jitter | `kidnet-tor-sync sync`, then applies the snippet inside the gateway namespace |

The timers stagger their first run after boot (60s, 90s, 2min, 3min) so they do
not all wake at once while the stack is still coming up.

To see what one of them last did:

    systemctl status kids-metering.service
    journalctl -u kids-services.service --since "30 min ago"
    journalctl -u kids-nic-warden.service -f

There is no timer for the safety net. The gateway container refreshes it itself,
hourly. `kidnet allow-sync` exists to force it from the host.

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

    kidnet time <kid>
    kidnet status

If it is out of time, the device should be seeing the captive portal, not a dead
connection. `kidnet bonus <kid> 15` reopens it.

**2. Does it have a lease, and is it a known device?**

    kidnet leases
    kidnet devices
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

    # 4. Put the plaintext in secrets.env, which is what the kidnet tools read.
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

**After changing the firewall, the gateway or `kidnet`:**

    sudo test/firewall-test.sh && sudo test/container-test.sh

Both must pass fully before you commit. This is not ceremony: the two worst
bugs this project has had were a ruleset that never parsed and a safety net that
existed only in the database, and both were caught the day these tests were
written.

**After changing policy in the database** (a new always_allow row, a renamed
child, a reassigned device):

    kidnet allow-sync                 # if you touched always_allow scope='safety'
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

To take Hearth down cleanly:

    docker compose --profile island down
    sudo systemctl stop kids-nic-warden.service
    sudo systemctl stop 'kids-*.timer'

To bring it back:

    sudo systemctl start kids-nic-warden.service
    docker compose --profile island up -d
    sudo systemctl start 'kids-*.timer'
    docker logs -f hearth-gw

Nothing above touches the host's own firewall, because Hearth never installs
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
