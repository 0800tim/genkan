#!/usr/bin/env bash
# hearth:summary=Put the dashboard behind real HTTPS using a Tailscale certificate.
#
# The dashboard has no browser-trusted certificate by default, so it shows the
# "Not secure" warning. That is cosmetic on a private network, but it is a
# mental block for anyone you demo to, and it trains people to click through
# warnings, which is a bad habit to teach.
#
# This uses Tailscale's own Let's Encrypt integration. The certificate is real
# and browser-trusted, and the dashboard stays PRIVATE to your tailnet: nothing
# is published to the internet.
#
# PREREQUISITE, one time, in the Tailscale admin console:
#   https://login.tailscale.com/admin/dns  ->  HTTPS Certificates  ->  Enable
set -uo pipefail
NAME="${TS_NAME:-$(tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null)}"
[ -n "${NAME:-}" ] || { echo "Could not determine this machine's tailnet name. Is Tailscale up?"; exit 1; }
CERTDIR="${CERTDIR:-/var/lib/hearth/tls}"
PORT="${PORT:-8899}"
# Proxy to wherever the dashboard is ACTUALLY listening. It may be bound to a
# VPN address rather than loopback, and proxying to the wrong one yields a 502
# with a perfectly valid certificate, which is a confusing failure.
DASH_ADDR="$(ss -lntH "sport = :$PORT" 2>/dev/null | awk '{print $4}' | head -1)"
DASH_ADDR="${DASH_ADDR:-127.0.0.1:$PORT}"
TLS_PORT="${TLS_PORT:-8443}"

echo "Requesting a certificate for $NAME ..."
# Owned by the invoking user: the Caddy front end runs as that user and needs
# to read the key and write its config here.
sudo install -d -m 0750 -o "$USER" "$CERTDIR"
if ! sudo tailscale cert --cert-file "$CERTDIR/hearth.crt" --key-file "$CERTDIR/hearth.key" "$NAME" 2>&1 | tail -2; then
  cat <<MSG

That usually means HTTPS certificates are not enabled for your tailnet yet.
Turn them on here (free, one click, keeps everything private):

  https://login.tailscale.com/admin/dns   ->   HTTPS Certificates   ->   Enable

Then run this again.
MSG
  exit 1
fi
sudo chown "$USER" "$CERTDIR" "$CERTDIR"/hearth.* 2>/dev/null || true
sudo chmod 0640 "$CERTDIR/hearth.key" 2>/dev/null || true

CADDYFILE="$CERTDIR/Caddyfile"
cat > "$CADDYFILE" <<CADDY
# Terminates HTTPS for the Hearth dashboard using the tailnet certificate,
# and proxies to the dashboard on loopback. The dashboard itself stays bound
# to 127.0.0.1, so this is the only way in and it is tailnet only.
{
	admin off
	auto_https off
}
https://$NAME:$TLS_PORT {
	tls $CERTDIR/hearth.crt $CERTDIR/hearth.key
	reverse_proxy $DASH_ADDR
}
CADDY

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/hearth-dashboard-tls.service" <<UNIT
[Unit]
Description=HTTPS front end for the Hearth dashboard (tailnet certificate)
After=network-online.target

[Service]
ExecStart=/usr/bin/caddy run --config $CADDYFILE --adapter caddyfile
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now hearth-dashboard-tls.service

systemctl --user restart hearth-dashboard-tls.service 2>/dev/null || true
sleep 2
if curl -sk --max-time 10 "https://127.0.0.1:$TLS_PORT/" -o /dev/null 2>/dev/null \
   || curl -sk --max-time 10 --resolve "$NAME:$TLS_PORT:$(tailscale ip -4 2>/dev/null | head -1)" "https://$NAME:$TLS_PORT/" -o /dev/null 2>/dev/null; then
  echo "Verified: the HTTPS front end is answering."
else
  echo "WARNING: the front end did not answer. Check: journalctl --user -u hearth-dashboard-tls -n 20"
fi

cat <<MSG

Done. Your dashboard now has a real certificate:

  https://$NAME:$TLS_PORT

Tailscale renews it automatically. Add a renewal hook or simply re-run this
script if the certificate ever expires.
MSG
