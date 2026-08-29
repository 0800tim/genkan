#!/usr/bin/env bash
# Proves the firewall guarantees with real packets, without any hardware and
# without touching this machine's networking. Everything happens inside three
# throwaway network namespaces:
#
#   hearth-kid (a kid's device) --- hearth-gw (the Hearth box) --- hearth-net (internet)
#
# The gateway namespace loads the real config/nftables/kids.nft, so what is
# tested here is the file that ships. Run: sudo test/firewall-test.sh
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
# Debian and Ubuntu put nft in /usr/sbin. Arch puts it in /usr/bin and keeps
# /usr/sbin only as a compatibility symlink, and a distro that drops that
# symlink would fail here in a way that looks like a firewall bug rather
# than a missing binary. Ask the system where it is.
NFT="$(command -v nft || echo /usr/sbin/nft)"
# Fail loudly on a missing tool. A security suite that cannot run its probes
# must say so, not report green. Everything the probes need is checked here.
for _t in ip nft python3; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
[ -x "$NFT" ] || { echo "nft not found. Install nftables."; exit 1; }
GW="ip netns exec hearth-gw"
KID="ip netns exec hearth-kid"
NET="ip netns exec hearth-net"
pass=0; fail=0

pids=""
cleanup(){
  # Kill the listeners first: they hold the namespaces open, and they inherit
  # stdout, so leaving them alive wedges anything piping this script's output.
  [ -z "$pids" ] || kill $pids 2>/dev/null
  for n in hearth-kid hearth-gw hearth-net; do ip netns del $n 2>/dev/null; done
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cleanup

# --- build the lab ---------------------------------------------------------
ip netns add hearth-gw; ip netns add hearth-kid; ip netns add hearth-net
ip link add kids0 type veth peer name k-eth0
ip link add wan0  type veth peer name n-eth0
ip link set kids0 netns hearth-gw;  ip link set k-eth0 netns hearth-kid
ip link set wan0  netns hearth-gw;  ip link set n-eth0 netns hearth-net

$GW  ip addr add 192.168.60.1/24 dev kids0
$GW  ip addr add 203.0.113.1/24  dev wan0
$KID ip addr add 192.168.60.50/24 dev k-eth0
$NET ip addr add 203.0.113.2/24   dev n-eth0
for ns in gw kid net; do ip netns exec hearth-$ns ip link set lo up; done
$GW ip link set kids0 up; $GW ip link set wan0 up
$KID ip link set k-eth0 up; $NET ip link set n-eth0 up
$KID ip route add default via 192.168.60.1
$NET ip route add default via 203.0.113.1
$GW sysctl -qw net.ipv4.ip_forward=1
# Stand-ins beyond the gateway: the main house LAN and a tailnet peer, both of
# which the island must never reach. On the far namespace, so they exercise the
# FORWARD isolation rule rather than the gateway's own input chain.
$NET ip addr add 192.168.1.10/24  dev n-eth0
$NET ip addr add 100.64.0.9/32  dev n-eth0
$GW  ip addr add 198.51.100.1/24   dev wan0   # a second the Hearth box address
# The gateway must be able to ROUTE to these, otherwise the packets die on an
# unreachable-network error and the isolation checks pass without the firewall
# ever seeing them. Give it the routes so the forward chain is what decides.
$GW  ip route add 192.168.1.0/24  dev wan0
$GW  ip route add 100.64.0.9/32 dev wan0
# Public resolvers, so we can prove a kid cannot escape our DNS. Bug-bounty
# levels 1 and 2: hardcode 8.8.8.8, or switch the browser to DoH.
$NET ip addr add 8.8.8.8/32 dev n-eth0
$NET ip addr add 1.1.1.1/32 dev n-eth0
$GW  ip route add 8.8.8.8/32 dev wan0
$GW  ip route add 1.1.1.1/32 dev wan0

$NFT --check -f "$R/config/nftables/kids.nft" || { echo "kids.nft does not parse"; exit 1; }
$GW $NFT -f "$R/config/nftables/kids.nft"
# .50 is a known, reserved device. .77 (used later) is a static-IP squatter.
$GW $NFT add element inet kids kids_known "{ 192.168.60.50 }"

# Listeners: a fake site out on the internet, and the Hearth box's own DNS + portal.
$NET python3 -c "
import socket,threading
def serve(p):
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('0.0.0.0',p)); s.listen(8)
    while True:
        c,_=s.accept(); c.sendall(b'FAR'); c.close()
for p in (80,443,853): threading.Thread(target=serve,args=(p,),daemon=True).start()
import time; time.sleep(600)" >/dev/null 2>&1 &
pids="$pids $!"
$GW python3 -c "
import socket,threading
def serve(p):
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('0.0.0.0',p)); s.listen(8)
    while True:
        c,_=s.accept(); c.sendall(b'GATEWAY'); c.close()
for p in (53,80,8899): threading.Thread(target=serve,args=(p,),daemon=True).start()
import time; time.sleep(600)" >/dev/null 2>&1 &
pids="$pids $!"
sleep 1.5

# --- helpers ---------------------------------------------------------------
# TCP reachability without netcat, which a default Arch install does not have.
# The old probe's absence would have made every "wanted no" assertion below
# pass for the wrong reason, since a missing binary and a blocked port look
# identical to a shell. bash speaks TCP itself, so nothing can go missing.
reach(){ $KID timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2" >/dev/null 2>&1; }   # 0 = reachable
# Who answered? A NAT redirect makes a connection to anywhere look successful,
# so identity, not reachability, is what proves the portal redirect.
who(){ $KID timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2; head -c 8 <&3" 2>/dev/null; }
banner(){ # banner <description> <expected banner> <host> <port>
  local got; got=$(who "$3" "$4")
  if [ "$got" = "$2" ]; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s (wanted %s, got %s)\n' "$1" "$2" "${got:-nothing}"; fi; }
check(){ # check <description> <want: yes|no> <host> <port>
  local want="$2"; local got=no
  reach "$3" "$4" && got=yes
  if [ "$got" = "$want" ]; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s (wanted %s, got %s)\n' "$1" "$want" "$got"; fi; }

elem(){ # elem <description> <set> <address>: is the address in the nft set?
  if $GW $NFT list set inet kids "$2" 2>/dev/null | grep -q "$3"; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s (%s not in @%s)\n' "$1" "$3" "$2"; fi; }

blockkid(){ $GW $NFT add element inet kids kids_block "{ 192.168.60.50 }"; }
unblockkid(){ $GW $NFT delete element inet kids kids_block "{ 192.168.60.50 }" 2>/dev/null; }
allow(){ $GW $NFT add element inet kids kids_allow "{ $1 }"; }
unallow(){ $GW $NFT flush set inet kids kids_allow; }

echo
echo "A kid who is ALLOWED online"
check "reaches the internet on :443"                 yes 203.0.113.2 443
banner "reaches the REAL site on :80, not the portal" FAR 203.0.113.2 80
check "reaches the DNS resolver on the Hearth box"          yes 192.168.60.1 53
check "cannot reach the main house LAN (isolation)"  no  192.168.1.10 80
check "cannot reach the tailnet (isolation)"         no  100.64.0.9 80
check "cannot reach the Hearth box's other addresses on :80" no 198.51.100.1 80
check "cannot reach the Hearth box's admin dashboard"       no  192.168.60.1 8899
check "cannot use DNS-over-TLS on :853"              no  203.0.113.2 853
banner "hardcoding 8.8.8.8 still lands on our resolver" GATEWAY 8.8.8.8 53
check "cannot reach Cloudflare DoH on 1.1.1.1:443"   no  1.1.1.1 443
check "cannot reach Google DoH on 8.8.8.8:443"       no  8.8.8.8 443

echo
echo "A kid who is CUT OFF (kidnet off / dinner / out of time)"
blockkid
check "loses the internet on :443"                   no  203.0.113.2 443
check "STILL reaches DNS (or the portal cannot name)" yes 192.168.60.1 53
check "STILL reaches the captive portal on :80"      yes 192.168.60.1 80
check "still cannot reach the main house LAN"        no  192.168.1.10 80
check "still cannot reach the admin dashboard"       no  192.168.60.1 8899
banner "gets the captive portal, not the real site, on :80" GATEWAY 203.0.113.2 80

echo
echo "The safety net: help lines survive the cut"
allow 203.0.113.2
check "reaches an always_allow address while cut off" yes 203.0.113.2 443
unallow
check "and a non-safety address is still blocked"     no 203.0.113.2 443

echo
echo "Back on"
unblockkid
check "internet returns"                              yes 203.0.113.2 443

echo
echo "Tor and the darknet (the IP layer)"
# 203.0.113.9 stands in for a public Tor relay. In production @tor_nodes holds
# the ~7-8k addresses kidnet-tor-sync fetches; the rules are the same either way.
$NET ip addr add 203.0.113.9/24 dev n-eth0
$GW $NFT add element inet kids tor_nodes "{ 203.0.113.9 }"
check "an online kid cannot reach a Tor relay"        no  203.0.113.9 443
elem  "the attempt is counted against the device"     tor_dev 192.168.60.50
# The precedence that matters most: the safety net sits ABOVE the Tor rules, so
# a help line sharing a CDN address with a relay is still reachable. A block
# that could silence 1737 would be a worse bug than missing Tor.
allow 203.0.113.9
check "SAFETY NET still wins over the Tor block"      yes 203.0.113.9 443
unallow
# An already-cut-off kid's attempt must still be counted: the alert is the
# point, and it must not depend on the kid being online at the time.
$GW $NFT flush set inet kids tor_dev
blockkid
check "a cut-off kid's relay attempt is still refused" no 203.0.113.9 443
elem  "and is still counted, so the alert still fires" tor_dev 192.168.60.50
unblockkid
$GW $NFT flush set inet kids tor_nodes
check "an address off the relay list is unaffected"   yes 203.0.113.9 443
check "and ordinary internet is untouched"            yes 203.0.113.2 443

echo
echo "Static-IP bypass (the headline 16yo dodge)"
# A device that sets an address we never reserved. Reachable at L2, forced DNS
# still works, but it is not in kids_known so it must get NO internet.
$KID ip addr add 192.168.60.77/24 dev k-eth0
check "known device (.50) still reaches the internet"  yes 203.0.113.2 443
$KID ip addr del 192.168.60.50/24 dev k-eth0 2>/dev/null
$KID ip route replace default via 192.168.60.1 src 192.168.60.77
check "UNKNOWN static IP (.77) gets NO internet"       no  203.0.113.2 443
banner "UNKNOWN static IP still lands on the portal :80" GATEWAY 203.0.113.2 80
allow 203.0.113.2
check "UNKNOWN static IP still reaches a help line"    yes 203.0.113.2 443
unallow
# restore. The .77 address has to GO, and the default route has to name .50 as
# its source, or everything after this still leaves as the unknown address and
# every later check fails for a reason that has nothing to do with what it is
# testing. That is the "passed for the wrong reason" trap in the other
# direction: failing for the wrong reason.
$KID ip addr add 192.168.60.50/24 dev k-eth0
$KID ip addr del 192.168.60.77/24 dev k-eth0 2>/dev/null
$KID ip route replace default via 192.168.60.1 src 192.168.60.50
check "the restore worked, so what follows tests what it says" yes 203.0.113.2 443

echo
echo "Unclaimed devices (a lease alone used to be full access)"
# A device with a lease but no owner. Before claim mode existed it passed
# @kids_known and got everything, which made a rotating phone MAC an accidental
# bypass. In the restricted lane it keeps DNS, the portal and the safety net,
# and loses the internet. The safety net rule sits ABOVE this one, and that
# ordering is the part worth testing: a child nobody has named yet must still
# be able to reach a help line.
$GW $NFT add element inet kids kids_unclaimed { 192.168.60.50 }
check "an unclaimed device gets NO ordinary internet"      no  203.0.113.2 443
banner "and its :80 still lands on the portal" GATEWAY 203.0.113.2 80
allow 203.0.113.2
check "and the safety net still wins over the restriction" yes 203.0.113.2 443
unallow
$GW $NFT delete element inet kids kids_unclaimed { 192.168.60.50 }
check "claiming it gives the internet straight back"       yes 203.0.113.2 443

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" = 0 ]
