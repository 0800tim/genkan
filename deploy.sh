#!/usr/bin/env bash
# Deploy Genkan: the containerised kids' gateway.
# Run with sudo on the gateway box. Idempotent. The ONLY host-side footprint
# is: the kidnet CLI, one config dir, and the kids-nic-warden systemd unit
# that hands the USB NIC to the gateway container. Everything else (firewall,
# DHCP, DNS, portal) runs inside containers that cannot touch the host's
# networking.
set -euo pipefail
R="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

[ -f "$R/config.env" ]  || { echo "copy config.env.example to config.env and set KIDS_NIC_MAC"; exit 1; }
[ -f "$R/secrets.env" ] || { echo "copy secrets.env.example to secrets.env and set the DB URLs"; exit 1; }

# ---- One-time migration from the Hearth-era names -------------------------
# The product was called Hearth until 2026-08-31 (DECISIONS.md, "The product
# is called Genkan"). A household that deployed before then has HEARTH_* keys
# in config.env, state under /var/lib/hearth, and containers called hearth-*.
# Every step below checks for the old thing and does nothing once it is gone,
# so this block costs a fresh install nothing and an old one exactly one run.
# Nothing is deleted before its replacement exists: the state directory is
# moved, not copied and removed, and AdGuard's volumes are copied before the
# old containers go. docs/UPGRADING.md describes what a parent will notice.
MIGRATED=0
if grep -q '^HEARTH_' "$R/config.env"; then
  cp -a "$R/config.env" "$R/config.env.pre-genkan"
  sed -i 's/^HEARTH_/GENKAN_/' "$R/config.env"
  echo "config.env: HEARTH_* keys renamed to GENKAN_* (the old file is config.env.pre-genkan)."
  MIGRATED=1
fi
if [ -d /var/lib/hearth ] && [ ! -e /var/lib/genkan ]; then
  mv /var/lib/hearth /var/lib/genkan
  echo "State moved from /var/lib/hearth to /var/lib/genkan (snapshots, health, Tor list)."
  MIGRATED=1
fi
if [ -f /etc/kids-network/hearth-root ]; then rm -f /etc/kids-network/hearth-root; MIGRATED=1; fi
# Moved, not deleted: a household may keep scripts of its own beside ours.
if [ -d /usr/local/lib/hearth ] && [ ! -e /usr/local/lib/genkan ]; then
  mv /usr/local/lib/hearth /usr/local/lib/genkan; MIGRATED=1
fi
# The worker and tool scripts were kidnet-*; the copies below are installed
# under genkan-* further down, and the units point at those. `kidnet` itself
# stays: it is the CLI's alias.
if ls /usr/local/bin/kidnet-* >/dev/null 2>&1; then rm -f /usr/local/bin/kidnet-*; MIGRATED=1; fi

. "$R/config.env"
: "${KIDS_NIC_MAC:?set KIDS_NIC_MAC in config.env}"

# Validate the ruleset before building anything with it.
echo "Validating firewall ruleset..."
/usr/sbin/nft -c -f "$R/config/nftables/kids.nft" || { echo "REFUSING TO DEPLOY: kids.nft does not parse"; exit 1; }

# Generate a real AdGuard admin password on first deploy (never ship one).
if ! grep -q '^ADGUARD_PASS=' "$R/secrets.env"; then
  APW="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
  AHASH="$(docker run --rm httpd:2.4-alpine htpasswd -nbBC 10 admin "$APW" 2>/dev/null | cut -d: -f2)"
  # AdGuard needs $2a/$2b bcrypt; httpd emits $2y which AdGuard rejects. Normalise.
  AHASH="${AHASH/\$2y\$/\$2b\$}"
  sed -i "s|password: REPLACE_AT_DEPLOY_WITH_BCRYPT_HASH|password: $AHASH|" "$R/config/adguard/AdGuardHome.yaml"
  { echo "ADGUARD_PASS=$APW"; echo "ADGUARD_URL=http://127.0.0.1:8853"; echo "ADGUARD_USER=admin"; } >> "$R/secrets.env"
  echo "Generated AdGuard admin password (stored in secrets.env, hash seeded)."
fi

# The daily budget must reset at local midnight, not UTC midnight. The
# Postgres container runs UTC, so pin the database's timezone to the
# household's or a NZ family's day rolls over at noon.
if [ -n "${GENKAN_TZ:-}" ]; then
  # SUPERUSER PATH, deliberately, and one of only three left. ALTER DATABASE is
  # owner-or-superuser work, and kids_agent is neither by design. It runs once,
  # at deploy, on a fixed string with one operator-supplied value (GENKAN_TZ
  # from config.env), so that value is checked to a timezone name's alphabet
  # before it goes anywhere near the statement.
  case "$GENKAN_TZ" in
    *[!A-Za-z0-9_/+-]*|"") echo "deploy: GENKAN_TZ '$GENKAN_TZ' is not a timezone name; skipping"; false;;
    *) true;;
  esac &&
  docker exec -i postgres psql -U postgres -d kids_network \
    -c "ALTER DATABASE kids_network SET timezone = '$GENKAN_TZ';" >/dev/null 2>&1 \
    && echo "Database day boundary set to $GENKAN_TZ."
fi

# The least-privilege role the CLI and the timers connect as. SUPERUSER PATH,
# deliberately: creating a role and granting on tables it does not own is the
# one thing kids_agent must never be able to do for itself. Idempotent, so an
# existing household picks the role up on the next deploy, and re-running it
# repairs a grant somebody dropped by hand. config/db/grants.sql explains what
# the role may touch and why.
if docker exec -i postgres psql -U postgres -d kids_network -tAc 'SELECT 1' >/dev/null 2>&1; then
  # Scheduled bedtimes, before the grants, because grants.sql grants on the
  # tables this file creates. SUPERUSER PATH for the same reason the role is:
  # it is DDL, and kids_agent has none by design.
  #
  # This is the one schema file deploy.sh applies on its own, and the reason is
  # specific: deploy.sh ENABLES kids-schedule.timer, so a household that
  # deployed without loading it would get a worker erroring into the journal
  # every minute, and a dashboard offering a bedtime form that saves nothing.
  # A timer we switch on has to have the tables it reads. The file is
  # idempotent by construction (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT
  # EXISTS, CREATE OR REPLACE), and on a database that already has it this is a
  # no-op. Every other schema file still goes through config/db/load.sh.
  serr=$(docker exec -i postgres psql -U postgres -d kids_network -q \
           < "$R/config/db/schema-schedule.sql" 2>&1 | grep '^ERROR' || true)
  if [ -z "$serr" ]; then
    echo "Bedtime tables are in place (no bedtimes are set; that is a parent's decision)."
  else
    echo "WARNING: the bedtime tables did not load, so kids-schedule.timer will do nothing:"
    echo "$serr" | sed 's/^/  /'
  fi
  # psql without ON_ERROR_STOP returns 0 even when a statement failed, so the
  # ERROR lines are what we actually read. A grant for a table this database
  # has not been given yet is worth naming, not worth stopping for.
  gerr=$(docker exec -i postgres psql -U postgres -d kids_network -q \
           < "$R/config/db/grants.sql" 2>&1 | grep '^ERROR' || true)
  if [ -z "$gerr" ]; then
    echo "Database role kids_agent is in place (the CLI is not a superuser)."
  else
    echo "Database role kids_agent is in place, but some grants did not apply:"
    echo "$gerr" | sed 's/^/  /'
    echo "  Usually this means a schema file has not been loaded into this database"
    echo "  yet: run config/db/load.sh, then deploy again. Until then the commands"
    echo "  that touch those tables will say 'permission denied'. See docs/DATABASE.md."
  fi
fi

echo "Building the gateway image..."
docker compose -f "$R/compose.yaml" build gateway

echo "Installing host pieces..."
install -m 0755 "$R/bin/genkan"        /usr/local/bin/genkan
# `kidnet` stays callable: the shim in the repo resolves relative to itself,
# so the installed copy needs its own one-liner pointing at the installed CLI.
printf '#!/usr/bin/env bash\n# The CLI is called genkan now; this name is kept for muscle memory.\nexec /usr/local/bin/genkan "$@"\n' > /usr/local/bin/kidnet
chmod 0755 /usr/local/bin/kidnet
install -m 0755 "$R/bin/genkan-meter"    /usr/local/bin/genkan-meter
install -m 0755 "$R/bin/genkan-adguard"  /usr/local/bin/genkan-adguard
install -m 0755 "$R/bin/genkan-adguard-clients" /usr/local/bin/genkan-adguard-clients
install -m 0755 "$R/bin/genkan-dnslog"   /usr/local/bin/genkan-dnslog
install -m 0755 "$R/bin/genkan-catmap"   /usr/local/bin/genkan-catmap
install -m 0755 "$R/bin/genkan-catmeter" /usr/local/bin/genkan-catmeter
install -m 0755 "$R/bin/genkan-devicescan" /usr/local/bin/genkan-devicescan
install -m 0755 "$R/bin/genkan-classify"    /usr/local/bin/genkan-classify
install -m 0755 "$R/bin/genkan-alerts"      /usr/local/bin/genkan-alerts
install -m 0755 "$R/bin/genkan-servicemap"   /usr/local/bin/genkan-servicemap
install -m 0755 "$R/bin/genkan-servicemeter" /usr/local/bin/genkan-servicemeter
install -m 0755 "$R/bin/genkan-tor-sync"    /usr/local/bin/genkan-tor-sync
install -m 0755 "$R/bin/genkan-iot-policy"  /usr/local/bin/genkan-iot-policy
install -m 0755 "$R/bin/genkan-schedule"    /usr/local/bin/genkan-schedule
install -m 0755 "$R/bin/genkan-notify"      /usr/local/bin/genkan-notify
# The pruner: nightly by timer, and what `genkan prune` hands over to.
install -m 0755 "$R/bin/genkan-prune"       /usr/local/bin/genkan-prune
# The release tooling. genkan-health is read-only and is the one a worried
# parent runs; the other two are how a household updates and how it goes back.
# The shared library is sourced by both, so it has to sit beside them.
install -m 0755 "$R/bin/genkan-health"      /usr/local/bin/genkan-health
install -m 0755 "$R/bin/genkan-upgrade"     /usr/local/bin/genkan-upgrade
install -m 0755 "$R/bin/genkan-rollback"    /usr/local/bin/genkan-rollback
install -m 0644 "$R/bin/genkan-release-lib.sh" /usr/local/bin/genkan-release-lib.sh
install -d -m 0755 /usr/local/lib/genkan /etc/kids-network
# Where genkan-tor-sync keeps the relay list and the generated nft snippet.
install -d -m 0755 /var/lib/genkan
# Where genkan-upgrade keeps the snapshots a rollback goes back to. Outside
# the repo deliberately: a rollback checks the repo out to an older commit,
# and the instructions for undoing that must not move when it happens.
install -d -m 0755 /var/lib/genkan/releases
install -m 0755 "$R/host/kids-nic-warden.sh" /usr/local/lib/genkan/kids-nic-warden.sh
install -m 0600 "$R/config.env"        /etc/kids-network/config.env
# Where this box's Genkan checkout lives, so the copies of genkan-health,
# genkan-upgrade and genkan-rollback in /usr/local/bin can find the code they
# are meant to be managing. From /usr/local/bin the directory above is
# /usr/local, which is not a checkout, and guessing wrong here would mean an
# upgrade tool that cannot find the thing it upgrades.
printf '%s\n' "$R" > /etc/kids-network/genkan-root
chmod 0644 /etc/kids-network/genkan-root
[ -f /etc/kids-network/devices.conf ] || install -m 0644 "$R/config/devices.conf" /etc/kids-network/devices.conf
install -m 0644 "$R/host/kids-nic-warden.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-meter.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-meter.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-dnslog.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-dnslog.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-metering.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-metering.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-devicescan.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-devicescan.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-services.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-services.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-tor-sync.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-tor-sync.timer"   /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-prune.service"     /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-prune.timer"       /etc/systemd/system/
# Scheduled bedtimes. Installed AND enabled, unlike the IoT timer below, because
# the switch here is the data, not the unit: with no rows in `schedules` the
# worker is a no-op, and a fresh install has none. The failure to avoid is a
# parent setting a bedtime on the dashboard and it silently never running
# because a timer they have never heard of was left off. See DECISIONS.md.
install -m 0644 "$R/config/systemd-network/kids-schedule.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-schedule.timer"   /etc/systemd/system/
# Notifications to a parent's phone. Installed AND enabled, and like the
# scheduler the switch is the data rather than the unit: with no rows in
# notify_routes the worker sends nothing to anybody and says so, and a fresh
# install has none. The failure to avoid is a parent adding a route on the
# dashboard and it silently never firing because a timer they have never heard
# of was left off. See docs/NOTIFICATIONS.md.
install -m 0644 "$R/config/systemd-network/kids-notify.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-notify.timer"   /etc/systemd/system/
# Household IoT policy. Installed but deliberately NOT enabled: it ships in
# observe mode and switching it on is a decision a parent makes once they have
# read what it will do. See docs/HOUSEHOLD-SECURITY.md.
install -m 0644 "$R/config/systemd-network/kids-iot-policy.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-iot-policy.timer"   /etc/systemd/system/
systemctl daemon-reload

# The rest of the Hearth-era migration: the containers. The compose project
# is called genkan now, so `up` below would build a second stack beside the
# old one, and the two would fight over the AdGuard port and the kids' NIC.
# AdGuard's config and its DHCP leases live in named volumes that carry the
# project name, so they are copied across first; the old containers and the
# old volumes are then removed. The database is not touched by any of this:
# it lives in the shared postgres container under its own name.
if docker ps -a --format '{{.Names}}' | grep -qx 'hearth-gw'; then
  echo "Migrating the hearth-* containers to genkan-* ..."
  for v in adguard-conf adguard-work; do
    if docker volume inspect "hearth_$v" >/dev/null 2>&1 && ! docker volume inspect "genkan_$v" >/dev/null 2>&1; then
      docker volume create "genkan_$v" >/dev/null
      docker run --rm -v "hearth_$v:/from:ro" -v "genkan_$v:/to" alpine:3 sh -c 'cp -a /from/. /to/'
      echo "  volume hearth_$v copied to genkan_$v"
    fi
  done
  docker rm -f hearth-adguard hearth-portal hearth-speedtest hearth-gw >/dev/null 2>&1 || true
  docker volume rm hearth_adguard-conf hearth_adguard-work >/dev/null 2>&1 || true
  docker network rm hearth_default >/dev/null 2>&1 || true
  MIGRATED=1
fi

echo "Starting the stack..."
docker compose -f "$R/compose.yaml" --profile island up -d
systemctl enable --now kids-nic-warden.service
# The warden is a long-running loop, so an edit to its unit or its script
# (the migration above moved both) only takes effect on a restart.
[ "$MIGRATED" = 1 ] && systemctl restart kids-nic-warden.service
systemctl enable --now kids-meter.timer
systemctl enable --now kids-dnslog.timer
systemctl enable --now kids-metering.timer
systemctl enable --now kids-devicescan.timer
systemctl enable --now kids-services.timer
systemctl enable --now kids-tor-sync.timer
systemctl enable --now kids-prune.timer
systemctl enable --now kids-schedule.timer
systemctl enable --now kids-notify.timer

# First Tor fetch runs now rather than up to a day from now, so @tor_nodes is
# populated before anyone connects. Deliberately non-fatal: a failed fetch
# must never fail a deploy. Everything else in the firewall still holds, and
# the daily timer retries. See docs/tor-and-safety.md for the honest limits
# of this layer (bridges and pluggable transports beat IP lists by design).
echo "Fetching the public Tor relay list (first run takes a minute)..."
systemctl start kids-tor-sync.service \
  || echo "  Tor relay list fetch failed; the daily timer will retry."

echo
echo "Deployed. Verify:"
echo "  docker logs -f genkan-gw          # watch for 'segment guard' + 'island is UP'"
echo "  genkan allow-status               # safety net populated?"
echo "  genkan-tor-sync status            # Tor relay list age and size"
echo "  sudo $R/test/container-test.sh    # full packet-level proof"
echo
echo "The gateway will NOT serve the island until the segment guard sees a"
echo "quiet wire (Deco factory reset + AP mode, nothing bridged to the house LAN)."
