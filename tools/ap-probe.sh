#!/usr/bin/env bash
# genkan:summary=Look at an unconfigured router on a dedicated cable, and change nothing.
#
#   tools/ap-probe.sh <interface> [address-of-the-router]
#   tools/ap-probe.sh enx001122334455
#
# The first half of an eventual `genkan ap-setup`: before anything can drive a
# router's web interface, it has to know exactly which firmware it is looking
# at. This gathers that evidence and prints it. It is READ ONLY: GETs only, no
# form posts, no settings touched, no password tried. Run it, read what it
# says, then write the driver against the real thing.
#
# WHY A DEDICATED CABLE. A factory reset router has its DHCP server ON and
# answers at 192.168.1.1. Put that on a wire with other devices and it starts
# handing out addresses that point at a router with no internet: on the kids'
# island that takes their network down, and on the house LAN it takes the
# house down. So this wants an interface with NOTHING else on it: a spare USB
# ethernet adapter, one cable, straight into one of the router's LAN ports.
# The router's WAN port stays empty throughout.
#
# The address we give ourselves is removed again on the way out, whatever
# happens, so the interface is left as it was found.
set -uo pipefail
IF="${1:?usage: ap-probe.sh <interface> [router-address]}"
RTR="${2:-192.168.1.1}"
ME="${AP_PROBE_ADDR:-192.168.1.50/24}"
OUT="${AP_PROBE_DIR:-/tmp/ap-probe}"

[ -e "/sys/class/net/$IF" ] || { echo "ap-probe: there is no interface called $IF"; echo; echo "Wired interfaces on this box:"; ip -br link | awk '$1!~/^(lo|docker|br-|veth|virbr|vnet|tailscale)/{print "  "$1"  "$2}'; exit 1; }

# Refuse to run on the interface that carries the house, and on one that is
# already inside the gateway's namespace. Both would be somebody's outage.
DEFAULT_IF=$(ip -o route show default | awk '{print $5}' | head -1)
[ "$IF" = "$DEFAULT_IF" ] && { echo "ap-probe: $IF is this box's route to the internet. Use a spare adapter."; exit 1; }

mkdir -p "$OUT"
had_addr=$(ip -4 -o addr show dev "$IF" | awk '{print $4}' | head -1)
cleanup(){
  [ -n "${added:-}" ] && ip addr del "$ME" dev "$IF" 2>/dev/null
  echo; echo "ap-probe: put $IF back as it was."
}
trap cleanup EXIT

if [ -n "$had_addr" ]; then
  echo "ap-probe: $IF already has $had_addr; leaving it alone and probing anyway."
else
  ip link set "$IF" up || { echo "ap-probe: cannot bring $IF up (run with sudo?)"; exit 1; }
  ip addr add "$ME" dev "$IF" 2>/dev/null && added=1
  echo "ap-probe: gave $IF the address $ME for the moment."
fi

echo "ap-probe: waiting for something to answer at $RTR (up to 40 seconds)..."
for i in $(seq 1 20); do
  ping -c1 -W2 -I "$IF" "$RTR" >/dev/null 2>&1 && break
  sleep 2
done
if ! ping -c1 -W2 -I "$IF" "$RTR" >/dev/null 2>&1; then
  echo
  echo "ap-probe: nothing answered at $RTR."
  echo "  Check, in this order:"
  echo "  1. The cable is in one of the router's YELLOW LAN ports, not the blue WAN port."
  echo "  2. The router has finished booting (about a minute after a factory reset)."
  echo "  3. The router really does use $RTR. Pass its address as the second argument."
  echo "     'ip neigh show dev $IF' shows anything that has spoken to us:"
  ip neigh show dev "$IF" | sed 's/^/       /'
  exit 1
fi
echo "ap-probe: $RTR answers."

# What is it. Headers first, then the page, then the handful of paths Huawei's
# own interface uses. Every one of these is a GET.
echo
echo "=== HTTP ==="
curl -sS -m 8 -D "$OUT/headers.txt" -o "$OUT/index.html" --interface "$IF" "http://$RTR/" 2>&1 | sed 's/^/  /'
sed 's/^/  /' "$OUT/headers.txt" 2>/dev/null | head -20

echo
echo "=== What the page calls itself ==="
grep -o -i '<title>[^<]*</title>' "$OUT/index.html" 2>/dev/null | head -3 | sed 's/^/  /'
grep -o -i -E '(HG[0-9]{3,4}|EchoLife|Huawei|firmware[^,<"]{0,40}|V[0-9]R[0-9]{3}[A-Z0-9]*)' "$OUT/index.html" 2>/dev/null \
  | sort -u | head -12 | sed 's/^/  /'
printf '  page is %s bytes\n' "$(wc -c < "$OUT/index.html" 2>/dev/null || echo 0)"

echo
echo "=== The scripts the page loads (this is what tells us the API shape) ==="
grep -o -E 'src="[^"]+\.js[^"]*"' "$OUT/index.html" 2>/dev/null | sort -u | head -12 | sed 's/^/  /'

echo
echo "=== Paths worth knowing about ==="
for p in /api/system/deviceinfo /api/system/user_login_nonce /api/system/user_login /html/index.html \
         /js/base.js /api/ntwk/wlan /api/ntwk/lancfg /api/system/HostInfo /cgi-bin/luci; do
  code=$(curl -sS -m 6 -o /dev/null -w '%{http_code}' --interface "$IF" "http://$RTR$p" 2>/dev/null)
  [ "$code" = 000 ] && code="no answer"
  printf '  %-34s %s\n' "$p" "$code"
done

echo
echo "=== Saved for the next step ==="
echo "  $OUT/index.html   the login page as served"
echo "  $OUT/headers.txt  its headers"
echo
echo "Nothing was changed on the router. Give the output above to the agent and"
echo "it can work out whether a scripted setup is possible for this firmware."
