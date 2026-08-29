#!/usr/bin/env bash
# Deploy Hearth: the containerised kids' gateway.
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
if [ -n "${HEARTH_TZ:-}" ]; then
  docker exec -i postgres psql -U postgres -d kids_network \
    -c "ALTER DATABASE kids_network SET timezone = '$HEARTH_TZ';" >/dev/null 2>&1 \
    && echo "Database day boundary set to $HEARTH_TZ."
fi

echo "Building the gateway image..."
docker compose -f "$R/compose.yaml" build gateway

echo "Installing host pieces..."
install -m 0755 "$R/bin/kidnet"        /usr/local/bin/kidnet
install -m 0755 "$R/bin/kidnet-meter"    /usr/local/bin/kidnet-meter
install -m 0755 "$R/bin/kidnet-adguard"  /usr/local/bin/kidnet-adguard
install -m 0755 "$R/bin/kidnet-adguard-clients" /usr/local/bin/kidnet-adguard-clients
install -m 0755 "$R/bin/kidnet-dnslog"   /usr/local/bin/kidnet-dnslog
install -m 0755 "$R/bin/kidnet-catmap"   /usr/local/bin/kidnet-catmap
install -m 0755 "$R/bin/kidnet-catmeter" /usr/local/bin/kidnet-catmeter
install -m 0755 "$R/bin/kidnet-devicescan" /usr/local/bin/kidnet-devicescan
install -m 0755 "$R/bin/kidnet-classify"    /usr/local/bin/kidnet-classify
install -m 0755 "$R/bin/kidnet-alerts"      /usr/local/bin/kidnet-alerts
install -m 0755 "$R/bin/kidnet-servicemap"   /usr/local/bin/kidnet-servicemap
install -m 0755 "$R/bin/kidnet-servicemeter" /usr/local/bin/kidnet-servicemeter
install -m 0755 "$R/bin/kidnet-tor-sync"    /usr/local/bin/kidnet-tor-sync
install -m 0755 "$R/bin/kidnet-iot-policy"  /usr/local/bin/kidnet-iot-policy
install -d -m 0755 /usr/local/lib/hearth /etc/kids-network
# Where kidnet-tor-sync keeps the relay list and the generated nft snippet.
install -d -m 0755 /var/lib/hearth
install -m 0755 "$R/host/kids-nic-warden.sh" /usr/local/lib/hearth/kids-nic-warden.sh
install -m 0600 "$R/config.env"        /etc/kids-network/config.env
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
# Household IoT policy. Installed but deliberately NOT enabled: it ships in
# observe mode and switching it on is a decision a parent makes once they have
# read what it will do. See docs/HOUSEHOLD-SECURITY.md.
install -m 0644 "$R/config/systemd-network/kids-iot-policy.service" /etc/systemd/system/
install -m 0644 "$R/config/systemd-network/kids-iot-policy.timer"   /etc/systemd/system/
systemctl daemon-reload

echo "Starting the stack..."
docker compose -f "$R/compose.yaml" --profile island up -d
systemctl enable --now kids-nic-warden.service
systemctl enable --now kids-meter.timer
systemctl enable --now kids-dnslog.timer
systemctl enable --now kids-metering.timer
systemctl enable --now kids-devicescan.timer
systemctl enable --now kids-services.timer
systemctl enable --now kids-tor-sync.timer

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
echo "  docker logs -f hearth-gw          # watch for 'segment guard' + 'island is UP'"
echo "  kidnet allow-status               # safety net populated?"
echo "  kidnet-tor-sync status            # Tor relay list age and size"
echo "  sudo $R/test/container-test.sh    # full packet-level proof"
echo
echo "The gateway will NOT serve the island until the segment guard sees a"
echo "quiet wire (Deco factory reset + AP mode, nothing bridged to the house LAN)."
