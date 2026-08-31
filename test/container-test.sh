#!/usr/bin/env bash
# End-to-end proof of the containerised gateway, no hardware needed.
# Builds the REAL image, runs it with the REAL capabilities from compose.yaml,
# hands it a veth pair standing in for the USB NIC using the SAME mechanism
# the host warden uses, then attacks it from a fake kid device.
#
# Section 1 proves containment: the container cannot see or touch the host.
# Section 2 proves the island works and the firewall guarantees hold.
# Section 3 proves the segment guard refuses a wire with foreign traffic.
# Run: sudo test/container-test.sh
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
# Same reason as firewall-test.sh: do not assume /usr/sbin is on root's PATH.
NFT="$(command -v nft || echo /usr/sbin/nft)"
# Fail loudly on a missing tool. A security suite that cannot run its probes
# must say so, not report green. Everything the probes need is checked here.
for _t in ip nft python3 docker; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
C=genkan-gw-test
KIDNS=genkantest-kid
pass=0; fail=0
ok(){ pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
# TCP reachability without netcat. bash speaks TCP itself, so this works on any
# distro and inside any namespace. 0 = reachable.
tcp(){ $KID timeout "${3:-2}" bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }
# A negative assertion has to tell "the firewall blocked it" apart from "the
# probe never ran". It could not: a missing binary exits 127, chk_not saw a
# non-zero exit, and reported PASS. netcat is absent from a default Arch
# install, which is now the intended production platform, so six of this
# file's isolation guarantees went green while testing nothing at all. 127 is
# now a hard failure, and probes below use bash's own TCP support so there is
# no external binary left to be missing.
chk_not(){ eval "$2" >/dev/null 2>&1; local rc=$?
  if [ "$rc" = 0 ]; then bad "$1"
  elif [ "$rc" = 127 ]; then bad "$1  [THE PROBE DID NOT RUN: command not found]"
  else ok "$1"; fi; }
KID="ip netns exec $KIDNS"
cleanup(){
  docker rm -f $C genkan-lst-test >/dev/null 2>&1
  ip netns del $KIDNS 2>/dev/null
  ip link del vkid0 2>/dev/null
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cleanup

echo "Building image..."
docker build -q -f "$R/gateway/Dockerfile" -t genkan-gw:test "$R" >/dev/null || { echo "BUILD FAILED"; exit 1; }

echo; echo "Section 1: containment"
# Note: a bit-for-bit host ruleset comparison is the WRONG claim on a shared
# Docker host, because Docker itself adds one isolation rule per container
# (ours or anyone's). The claim we make is: nothing of OURS appears there.
docker run -d --name $C --cap-add NET_ADMIN --cap-add NET_RAW --cap-drop ALL \
  --sysctl net.ipv4.ip_forward=1 genkan-gw:test >/dev/null
PID=$(docker inspect -f '{{.State.Pid}}' $C)
chk "container runs unprivileged (no SYS_ADMIN in CapEff)" \
  "! grep -q 'CapEff:.*0000003fffffffff' /proc/$PID/status && ! capsh --decode=\$(awk '/CapEff/{print \$2}' /proc/$PID/status) | grep -q sys_admin"
chk_not "container cannot see the host uplink enp5s0" "docker exec $C ip link show enp5s0"
chk_not "container cannot see the host tailscale interface" "docker exec $C ip link show tailscale0"

# Hand over a fake USB NIC exactly the way the warden does.
ip link add vkid0 type veth peer name vgw0
ip link set vgw0 down
ip link set vgw0 netns "$PID" name kids0
ip netns add $KIDNS
ip link set vkid0 netns $KIDNS
$KID ip addr add 192.168.60.50/24 dev vkid0
$KID ip link set lo up; $KID ip link set vkid0 up
$KID ip route add default via 192.168.60.1

echo "  ...waiting for the gateway to adopt kids0 (segment guard runs ~8s)"
for i in $(seq 1 30); do
  docker logs $C 2>&1 | grep -q "island is UP" && break; sleep 1
done
chk "gateway adopted the NIC and reports island UP" "docker logs $C 2>&1 | grep -q 'island is UP'"
docker exec $C nft add element inet kids kids_known "{ 192.168.60.50 }" 2>/dev/null
chk "segment guard passed on a quiet wire" "docker logs $C 2>&1 | grep -q 'safe to own it'"
chk_not "no kids table appears in the HOST firewall" "$NFT list tables 2>/dev/null | grep -qw kids"
# The containerised gateway must leave no trace on the host. The interim
# internet-share service (genkan-share-gateway) deliberately does add host NAT
# for the island subnet, so skip this check while that is running rather than
# report a false failure: it is superseded at cutover.
if systemctl is-active --quiet genkan-share-gateway 2>/dev/null; then
  printf '  \033[33mSKIP\033[0m  island subnet on host (interim share gateway is running by design)\n'
else
  chk_not "the island subnet appears nowhere in the HOST ruleset" "$NFT -s list ruleset 2>/dev/null | grep -q 192.168.60"
fi
chk "firewall loaded INSIDE the container" "docker exec $C nft list set inet kids kids_block"

echo; echo "Section 2: the island works, guarantees hold"
INET443=$(getent ahostsv4 cloudflare.com 2>/dev/null | awk 'NR==1{print $1}')
[ -n "$INET443" ] || { INET443=104.16.132.229; echo "  (offline? using pinned CF address)"; }
# Listeners in the gateway namespace: portal on :80, resolver stand-in on :53.
docker run -d --rm --name genkan-lst-test --network container:$C python:3.12-alpine python3 -c "
import socket,threading
def serve(p):
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('0.0.0.0',p)); s.listen(8)
    while True:
        c,_=s.accept(); c.sendall(b'GATEWAY'); c.close()
for p in (53,80): threading.Thread(target=serve,args=(p,),daemon=True).start()
import time; time.sleep(600)" >/dev/null
sleep 2
banner(){ $KID timeout 3 bash -c "exec 3<>/dev/tcp/$2/$3; head -c7 <&3" 2>/dev/null; }
[ "$(banner x 192.168.60.1 80)" = GATEWAY ] && ok "kid reaches the portal on the gateway" || bad "kid cannot reach the portal"
chk "kid reaches DNS on the gateway" "tcp 192.168.60.1 53"
chk "kid gets real internet through the container (NAT out eth0)" "tcp 1.1.1.1 80 3"
chk_not "kid CANNOT reach the main house LAN (192.168.1.10)" "tcp 192.168.1.10 8899"
chk_not "kid CANNOT reach the host postgres network (172.18.0.2:5432)" "tcp 172.18.0.2 5432"
chk_not "kid CANNOT reach the tailnet (100.64.0.10:8899)" "tcp 100.64.0.10 8899"
chk_not "kid CANNOT use DoH (1.1.1.1:443)" "tcp 1.1.1.1 443"
[ "$(banner x 8.8.8.8 53)" = GATEWAY ] && ok "hardcoded 8.8.8.8 DNS lands on OUR resolver" || bad "8.8.8.8 escape not redirected"

# Static-IP bypass: a device on an address we never handed out gets nothing.
# Use a fresh destination the known kid never touched, so no masquerade
# conntrack is inherited when this one netns changes identity (a real separate
# device never shares that state).
$KID ip addr add 192.168.60.88/24 dev vkid0 2>/dev/null
$KID ip addr del 192.168.60.50/24 dev vkid0 2>/dev/null
$KID ip route replace default via 192.168.60.1 2>/dev/null
chk_not "static-IP squatter (.88) gets NO internet" "tcp 9.9.9.9 443 3"
$KID ip addr add 192.168.60.50/24 dev vkid0 2>/dev/null
$KID ip addr del 192.168.60.88/24 dev vkid0 2>/dev/null
$KID ip route replace default via 192.168.60.1 2>/dev/null
docker exec $C nft add element inet kids kids_block "{ 192.168.60.50 }"
chk_not "blocked kid loses the internet (:443 resets fast)" "tcp $INET443 443"
[ "$(banner x 93.184.216.34 80)" = GATEWAY ] && ok "blocked kid's web lands on the captive portal" || bad "blocked kid not redirected to portal"
chk "blocked kid still reaches DNS" "tcp 192.168.60.1 53"
docker exec $C nft add element inet kids kids_allow "{ $INET443 }"
chk "blocked kid still reaches a safety-net address" "tcp $INET443 443 3"
docker exec $C nft flush set inet kids kids_allow
docker exec $C nft delete element inet kids kids_block "{ 192.168.60.50 }"
chk "unblocked kid gets the internet back" "tcp $INET443 443 3"

echo; echo "Section 3: replug resilience + segment guard refusal"
# Rip the NIC out (simulates USB replug): kernel returns veth to host on ns delete.
docker exec $C ip link set kids0 down
docker exec $C ip link set kids0 name dead0   # make it vanish from the gateway's view
sleep 8
chk "gateway noticed the NIC vanish" "docker logs $C 2>&1 | grep -q 'kids0 vanished'"
docker exec $C ip link set dead0 name kids0
for i in $(seq 1 25); do docker logs $C 2>&1 | grep -c "island is UP" | grep -q 2 && break; sleep 1; done
chk "gateway re-adopted the NIC after replug" "docker logs $C 2>&1 | grep -c 'island is UP' | grep -q 2"

# Fresh container, but this time the wire carries foreign house-LAN traffic.
docker rm -f $C genkan-lst-test >/dev/null 2>&1; ip netns del $KIDNS 2>/dev/null; ip link del vkid0 2>/dev/null
docker run -d --name $C --cap-add NET_ADMIN --cap-add NET_RAW --cap-drop ALL \
  --sysctl net.ipv4.ip_forward=1 genkan-gw:test >/dev/null
PID=$(docker inspect -f '{{.State.Pid}}' $C)
ip link add vkid0 type veth peer name vgw0
ip link set vgw0 down; ip link set vgw0 netns "$PID" name kids0
ip netns add $KIDNS; ip link set vkid0 netns $KIDNS
$KID ip addr add 192.168.1.7/24 dev vkid0   # pretend to be the HOUSE LAN
$KID ip link set vkid0 up; $KID ip link set lo up
# Simulate a COMPETING DHCP SERVER on the wire (the real danger the guard
# exists for: our DHCP would fight the house router). Client ARP noise is
# deliberately NOT a trip condition, so we must emit genuine server traffic:
# UDP with SOURCE port 67, which only a DHCP server sends.
$KID python3 -c "
import socket,time
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET,socket.SO_BROADCAST,1)
s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('192.168.1.7',67))
for _ in range(40):
    try: s.sendto(b'\\x02'+b'\\x00'*300,('255.255.255.255',68))
    except Exception: pass
    time.sleep(0.5)
" >/dev/null 2>&1 &
NOISE=$!
for i in $(seq 1 30); do docker logs $C 2>&1 | grep -q "segment guard TRIPPED" && break; sleep 1; done
kill $NOISE 2>/dev/null
chk "segment guard REFUSES a wire carrying house-LAN traffic" "docker logs $C 2>&1 | grep -q 'segment guard TRIPPED'"
chk_not "and the island did NOT come up on the poisoned wire" "docker logs $C 2>&1 | grep -q 'island is UP'"

echo; printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" = 0 ]
