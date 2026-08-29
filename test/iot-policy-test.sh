#!/usr/bin/env bash
# Proves the household IoT security policy with real packets, on the real
# ruleset, without touching this machine's networking or the live gateway.
#
# The lab, all in throwaway network namespaces:
#
#            camera .201 ---\
#            vacuum .202 ----+--[ kids0 bridge ]-- hearth-iot-gw --- internet
#            speaker .203 --/                          |             203.0.113.x
#            phone  .204 --/                      the real kids.nft
#                                                 + the generated policy
#
# Every device holds a /32 and reaches everything, including its neighbours,
# through the gateway. That is not a trick to make the test pass: it is what a
# household looks like once client isolation is turned on at the access point,
# which is the configuration this policy is designed for and the one
# docs/HOUSEHOLD-SECURITY.md tells a parent to use. On a plain access point the
# neighbours' frames never reach the gateway at all and no firewall on earth
# can judge them, which the documentation says in as many words.
#
# The gateway namespace loads the REAL config/nftables/kids.nft and then the
# REAL bin/kidnet-iot-policy generates the policy on top of it from the REAL
# database rows, so what is tested here is what ships.
#
# Run: sudo test/iot-policy-test.sh
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
# Discovered, not assumed: Arch keeps nft in /usr/bin. Failing loudly matters
# more than the path, because a security suite that cannot run its tools must
# say so rather than report green.
NFT="$(command -v nft || echo /usr/sbin/nft)"
for _t in ip nft python3; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
GWNS=hearth-iot-gw
NETNS=hearth-iot-net
DEVNS="hearth-iot-cam hearth-iot-vac hearth-iot-spk hearth-iot-phone"
GW="ip netns exec $GWNS"
CAM="ip netns exec hearth-iot-cam"
VAC="ip netns exec hearth-iot-vac"
SPK="ip netns exec hearth-iot-spk"
PHONE="ip netns exec hearth-iot-phone"
NET="ip netns exec $NETNS"
pass=0; fail=0; pids=""
psql(){ docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"; }
policy(){ NFT_NS=$GWNS IOT_POLICY_MODE="$1" bash "$R/bin/kidnet-iot-policy" apply >"$TMP/apply.log" 2>&1; }

cleanup(){
  [ -z "$pids" ] || kill $pids 2>/dev/null
  for n in $GWNS $NETNS $DEVNS; do ip netns del $n 2>/dev/null; done
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
  # The test rows, and nothing else. device_policy and device_access_grants
  # both cascade from devices, so removing the devices removes the policy.
  psql "DELETE FROM devices WHERE label LIKE 'iot-test-%'" >/dev/null 2>&1
  psql "DELETE FROM vendor_ips WHERE host(ip) LIKE '203.0.113.%'" >/dev/null 2>&1
}
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cleanup
# After the opening sweep, or the sweep would take the scratch directory with it.
TMP="$(mktemp -d -t iot-policy-test.XXXXXX)"

ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

# --- the lab ---------------------------------------------------------------
ip netns add $GWNS; ip netns add $NETNS
for n in $DEVNS; do ip netns add $n; done

$GW ip link add name kids0 type bridge
$GW ip link set kids0 up
$GW ip addr add 192.168.60.1/24 dev kids0
ip link add wan0 type veth peer name n-eth0
ip link set wan0 netns $GWNS; ip link set n-eth0 netns $NETNS
$GW ip addr add 203.0.113.1/24 dev wan0; $GW ip link set wan0 up
$GW ip link set lo up
$GW sysctl -qw net.ipv4.ip_forward=1
# No ICMP redirects: we want every neighbour packet to keep coming through the
# firewall, not to be handed a shortcut after the first one.
$GW sysctl -qw net.ipv4.conf.all.send_redirects=0

join(){ # join <netns> <last octet> <veth name>
  local h; h=$(printf '%02x' "$2")
  ip link add "$3" type veth peer name e0
  ip link set "$3" netns $GWNS
  ip link set e0 netns "$1"
  # Explicit MACs. Veth pairs created back to back in the same namespace can
  # come up sharing one address, and two devices behind a bridge with the same
  # MAC quietly stop being two devices, which would make every neighbour test
  # here pass or fail for the wrong reason.
  $GW ip link set "$3" address "02:00:00:00:01:$h"
  ip netns exec "$1" ip link set e0 address "02:00:00:00:02:$h"
  $GW ip link set "$3" master kids0; $GW ip link set "$3" up
  ip netns exec "$1" ip link set lo up
  ip netns exec "$1" ip link set e0 up
  ip netns exec "$1" ip addr add "192.168.60.$2/32" dev e0
  ip netns exec "$1" ip route add 192.168.60.1 dev e0
  ip netns exec "$1" ip route add default via 192.168.60.1
}
join hearth-iot-cam   201 v-cam
join hearth-iot-vac   202 v-vac
join hearth-iot-spk   203 v-spk
join hearth-iot-phone 204 v-phone

$NET ip link set lo up; $NET ip link set n-eth0 up
$NET ip addr add 203.0.113.2/24 dev n-eth0      # the camera's vendor cloud
$NET ip addr add 203.0.113.3/32 dev n-eth0      # somewhere else on the internet
$NET ip addr add 203.0.113.4/32 dev n-eth0      # the vacuum's vendor cloud
$NET ip addr add 192.168.1.10/32 dev n-eth0     # the main house LAN, stand-in
$NET ip route add default via 203.0.113.1
# The strongest form of the inbound attack: somebody out there who knows the
# island's addresses AND can route to them. NAT would normally stop this on its
# own; the point is to prove the policy stops it without relying on NAT.
$NET ip route add 192.168.60.0/24 via 203.0.113.1
$GW  ip route add 192.168.1.10/32 dev wan0

$NFT --check -f "$R/config/nftables/kids.nft" || { echo "kids.nft does not parse"; exit 1; }
$GW $NFT -f "$R/config/nftables/kids.nft"
$GW $NFT add element inet kids kids_known "{ 192.168.60.201, 192.168.60.202, 192.168.60.203, 192.168.60.204 }"

listen(){ ip netns exec "$1" python3 -c "
import socket,threading,time
def serve(p):
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    s.bind(('0.0.0.0',p)); s.listen(8)
    while True:
        try: c,_=s.accept()
        except Exception: return
        c.sendall(b'$2'); c.close()
for p in (80,443): threading.Thread(target=serve,args=(p,),daemon=True).start()
time.sleep(900)" >/dev/null 2>&1 & pids="$pids $!"; }
listen $NETNS FAR
listen hearth-iot-cam CAM
listen hearth-iot-vac VAC
listen hearth-iot-phone PHONE
sleep 1.5

# --- the devices, as database rows -----------------------------------------
add_dev(){ # add_dev <mac> <label> <ip> <kind> <category> <vendor>
  psql "INSERT INTO devices(mac,label,hostname,reserved_ip,kind,category,vendor,is_active,last_seen)
        VALUES('$1','$2','$2','$3','$4','$5',$([ -z "$6" ] && echo NULL || echo "'$6'"),true,now())
        ON CONFLICT (mac) DO UPDATE SET label='$2', reserved_ip='$3', kind='$4', category='$5'" >/dev/null; }
add_dev ce:11:00:00:00:01 iot-test-camera  192.168.60.201 camera  iot      Reolink
add_dev ce:11:00:00:00:02 iot-test-vacuum  192.168.60.202 vacuum  iot      iRobot
add_dev ce:11:00:00:00:03 iot-test-speaker 192.168.60.203 speaker iot      Amazon
add_dev ce:11:00:00:00:04 iot-test-phone   192.168.60.204 phone   personal ""
# The camera's vendor cloud, "learned" from a DNS answer. The vacuum's vendor
# is deliberately left with nothing learned, to prove the fail-safe.
psql "INSERT INTO vendor_ips(ip,vendor_id,seen) SELECT '203.0.113.2', id, now() FROM vendor_clouds WHERE vendor='Reolink'
      ON CONFLICT (ip,vendor_id) DO UPDATE SET seen=now()" >/dev/null

# --- helpers ---------------------------------------------------------------
# got defaults to "no", so anything that stops the probe running satisfies
# every want=no assertion without testing a thing. netcat used to be that
# thing: it is absent from a default Arch install, and these five would have
# gone green on the very platform now intended for production:
#   the vacuum cannot reach the rest of the internet
#   a phone cannot reach the main house LAN
#   a cut-off phone loses the internet
#   a cut-off phone cannot use the camera grant as a way around it
#   an unknown device gets no internet
# bash speaks TCP itself, so there is no external binary left to be missing.
check(){ # check <description> <yes|no> <netns> <host> <port>
  local want="$2" got=no
  ip netns exec "$3" timeout 2 bash -c "exec 3<>/dev/tcp/$4/$5" >/dev/null 2>&1 && got=yes
  [ "$got" = "$want" ] && ok "$1" || bad "$1 (wanted $want, got $got)"; }
banner(){ # banner <description> <expected> <netns> <host> <port>
  local got; got=$(ip netns exec "$3" timeout 2 bash -c "exec 3<>/dev/tcp/$4/$5; head -c 8 <&3" 2>/dev/null)
  [ "$got" = "$2" ] && ok "$1" || bad "$1 (wanted $2, got ${got:-nothing})"; }
counted(){ # counted <description> <rule text fragment>
  if $GW $NFT list chain inet kids iotpolicy 2>/dev/null | grep -F "$2" | grep -qE 'counter packets [1-9]'
  then ok "$1"; else bad "$1 (no packets counted on: $2)"; fi; }

echo
echo "The generated ruleset"
NFT_NS=$GWNS IOT_POLICY_MODE=enforce bash "$R/bin/kidnet-iot-policy" dryrun 2>/dev/null > "$TMP/rules.nft"
[ -s "$TMP/rules.nft" ] && ok "policy generated from database rows" || bad "generator produced nothing"
$GW $NFT -c -f "$TMP/rules.nft" >/dev/null 2>&1 \
  && ok "generated ruleset validates (nft -c -f)" || bad "generated ruleset does not validate"
grep -q 'priority -5' "$TMP/rules.nft" \
  && ok "policy chain runs BEFORE kids.nft's forward chain" || bad "policy chain priority wrong"
grep -q 'ip daddr @kids_allow return' "$TMP/rules.nft" \
  && ok "the safety net is returned from before any policy applies" || bad "safety net not protected"

echo
echo "OBSERVE mode: the shipped default must change nothing"
policy observe
check "the camera still reaches anywhere on the internet"   yes hearth-iot-cam 203.0.113.3 443
$GW $NFT list chain inet kids forward | grep -q 'hearth-iot-allow' \
  && bad "observe mode inserted rules into kids.nft's forward chain" \
  || ok  "observe mode leaves kids.nft's own forward chain alone"
$GW $NFT list chain inet kids iotpolicy | grep -qE '\b(drop|reject)\b' \
  && bad "observe mode contains a real deny" || ok "observe mode contains no deny, only counters"
counted "but it counts what enforcing WOULD have refused" "vendor-restricted device reaching anything else"

echo
echo "ENFORCE mode: a camera locked down"
policy enforce
banner "the camera reaches its VENDOR CLOUD (remote recording keeps working)" FAR hearth-iot-cam 203.0.113.2 443
check  "the camera cannot reach anywhere else on the internet"    no  hearth-iot-cam 203.0.113.3 443
check  "the camera cannot reach a phone"                          no  hearth-iot-cam 192.168.60.204 80
check  "the camera cannot reach another smart device"             no  hearth-iot-cam 192.168.60.202 80
check  "the camera cannot reach the main house LAN"               no  hearth-iot-cam 192.168.1.10 80
check  "nothing on the internet can start a conversation with it" no  $NETNS 192.168.60.201 80
counted "the refused lateral attempt is counted, so it can be reported" "lateral movement between smart devices"

echo
echo "The trap: a parent viewing their own camera must keep working"
banner "the phone CAN reach the camera (class default allows it)" CAM hearth-iot-phone 192.168.60.201 80
NFT_NS=$GWNS bash "$R/bin/kidnet-iot-policy" set iot-test-camera reachable_from_personal no >/dev/null
policy enforce
check  "after the parent closes it, the phone cannot"       no  hearth-iot-phone 192.168.60.201 80
NFT_NS=$GWNS bash "$R/bin/kidnet-iot-policy" allow iot-test-phone iot-test-camera "parent phone" >/dev/null
policy enforce
banner "with an explicit grant, that one phone gets back in" CAM hearth-iot-phone 192.168.60.201 80
check  "and the camera still cannot reach the phone the other way" no hearth-iot-cam 192.168.60.204 80

echo
echo "Other classes"
check "a speaker keeps the ordinary internet (class default)"  yes hearth-iot-spk 203.0.113.3 443
check "a vacuum with no vendor addresses learned is NOT locked out (fail-safe)" yes hearth-iot-vac 203.0.113.3 443
grep -q "no addresses known for vendor 'iRobot'" "$TMP/apply.log" \
  && ok "and the gap is reported rather than silently enforced" || bad "fail-safe not reported"
psql "INSERT INTO vendor_ips(ip,vendor_id,seen) SELECT '203.0.113.4', id, now() FROM vendor_clouds WHERE vendor='iRobot'
      ON CONFLICT (ip,vendor_id) DO UPDATE SET seen=now()" >/dev/null
policy enforce
check "once its vendor is known the vacuum is pinned to it"    yes hearth-iot-vac 203.0.113.4 443
check "and cannot reach the rest of the internet"              no  hearth-iot-vac 203.0.113.3 443

echo
echo "Nothing the existing suites guarantee may break"
$GW $NFT add element inet kids kids_allow "{ 203.0.113.3 }"
check "the safety net still wins over a vendor lock"           yes hearth-iot-cam 203.0.113.3 443
$GW $NFT flush set inet kids kids_allow
check "a phone still reaches the internet"                     yes hearth-iot-phone 203.0.113.2 443
check "a phone still cannot reach the main house LAN"          no  hearth-iot-phone 192.168.1.10 80
$GW $NFT add element inet kids kids_block "{ 192.168.60.204 }"
check "a cut-off phone still loses the internet"               no  hearth-iot-phone 203.0.113.2 443
check "and a cut-off phone cannot use the camera grant as a way around it" no hearth-iot-phone 192.168.60.201 80
$GW $NFT delete element inet kids kids_block "{ 192.168.60.204 }"
$GW $NFT delete element inet kids kids_known "{ 192.168.60.202 }"
policy enforce
check "an unknown device gets no internet even under IoT policy" no hearth-iot-vac 203.0.113.4 443
$GW $NFT add element inet kids kids_known "{ 192.168.60.202 }"

echo
echo "Fail-safe: the household must not be locked out by our own outage"
policy enforce
before=$($GW $NFT list chain inet kids iotpolicy | grep -c .)
NFT_NS=$GWNS IOT_POLICY_MODE=enforce PG_CONTAINER=no-such-database \
  bash "$R/bin/kidnet-iot-policy" apply >"$TMP/dbdown.log" 2>&1
grep -q 'database unreachable' "$TMP/dbdown.log" \
  && ok "a database outage is reported, not acted on" || bad "database outage not handled"
[ "$($GW $NFT list chain inet kids iotpolicy | grep -c .)" = "$before" ] \
  && ok "and the rules already loaded are left exactly as they were" || bad "outage changed the ruleset"
banner "so the camera keeps talking to its cloud through the outage" FAR hearth-iot-cam 203.0.113.2 443
banner "and the parent keeps their camera view"                      CAM hearth-iot-phone 192.168.60.201 80

echo
echo "Reapplying is idempotent (a chain that grows every minute is a bug)"
policy enforce; policy enforce; policy enforce
[ "$($GW $NFT list chain inet kids iotpolicy | grep -c 'comment')" = "$($GW $NFT list chain inet kids iotpolicy | sort -u | grep -c 'comment')" ] \
  && ok "the policy chain has no duplicate rules after three passes" || bad "policy chain duplicated its rules"
[ "$($GW $NFT list chain inet kids forward | grep -c 'hearth-iot-allow')" = 8 ] \
  && ok "and exactly 8 exceptions sit in kids.nft's forward chain, not 24" \
  || bad "forward-chain exceptions duplicated ($($GW $NFT list chain inet kids forward | grep -c 'hearth-iot-allow') found)"

echo
echo "Turning it off"
policy off
$GW $NFT list chain inet kids iotpolicy >/dev/null 2>&1 \
  && bad "mode=off left the policy chain loaded" || ok "mode=off removes the policy chain"
$GW $NFT list chain inet kids forward | grep -q 'hearth-iot-allow' \
  && bad "mode=off left rules in kids.nft's forward chain" || ok "mode=off removes its forward-chain exceptions"
check "and every device is back to the plain island rules"     yes hearth-iot-cam 203.0.113.3 443

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" = 0 ]
