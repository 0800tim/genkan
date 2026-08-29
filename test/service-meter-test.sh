#!/usr/bin/env bash
# Proves per-service byte accounting: learned IPs, per-device counters, and the
# daily rollup that turns them into "how much Netflix did Ben watch".
# Uses a throwaway netns and synthetic counters, so no real traffic is needed.
set -u
# A suite that cannot run its own tools must say so, not report green.
for _t in nft python3 docker; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
R="$(cd "$(dirname "$0")/.." && pwd)"
NS=svcmetertest
pass=0; fail=0
ok(){ pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"; }
cleanup(){ ip netns del $NS 2>/dev/null
  psql "DELETE FROM service_usage WHERE child_id=(SELECT id FROM children ORDER BY id LIMIT 1) AND day=CURRENT_DATE" >/dev/null
  psql "DELETE FROM service_ips WHERE host(ip)='203.0.113.55'" >/dev/null
  psql "DELETE FROM devices WHERE label='svc-meter-test'" >/dev/null; }
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cleanup

CID=$(psql "SELECT id FROM children ORDER BY id LIMIT 1")
KID=$(psql "SELECT name FROM children WHERE id=$CID")
ip netns add $NS
ip netns exec $NS nft -f "$R/config/nftables/kids.nft"

# A device owned by a real child, and a YouTube address learned from "DNS".
psql "INSERT INTO devices(mac,label,child_id,reserved_ip,kind,category,is_active,last_seen)
      VALUES('cc:dd:ee:00:00:77','svc-meter-test',$CID,'192.168.60.210','phone','personal',true,now())
      ON CONFLICT (mac) DO UPDATE SET child_id=$CID, reserved_ip='192.168.60.210', label='svc-meter-test'" >/dev/null
psql "INSERT INTO service_ips(ip,service_id,seen) SELECT '203.0.113.55', id, now() FROM services WHERE name='youtube'
      ON CONFLICT (ip,service_id) DO UPDATE SET seen=now()" >/dev/null

echo "Per-service byte accounting"
NFT_NS=$NS ADGUARD_PASS="${ADGUARD_PASS:-x}" bash "$R/bin/kidnet-servicemeter" >/dev/null 2>&1
ip netns exec $NS nft list set inet kids svc_youtube_ips 2>/dev/null | grep -q '203.0.113.55' \
  && ok "learned YouTube address loaded into the firewall set" || bad "service IP set not populated"
ip netns exec $NS nft list chain inet kids servicemetering >/dev/null 2>&1 \
  && ok "metering chain created" || bad "metering chain missing"
ip netns exec $NS nft list chain inet kids servicemetering 2>/dev/null | grep -qE 'drop|reject' \
  && bad "metering chain contains a verdict (must only count)" || ok "metering chain only counts, never blocks"

# Synthetic traffic: 5 MB from that device to YouTube.
ip netns exec $NS nft add element inet kids svc_youtube_dev "{ 192.168.60.210 counter packets 400 bytes 5242880 }" 2>/dev/null
NFT_NS=$NS ADGUARD_PASS="${ADGUARD_PASS:-x}" bash "$R/bin/kidnet-servicemeter" >/dev/null 2>&1
B=$(psql "SELECT bytes FROM service_usage u JOIN services s ON s.id=u.service_id
          WHERE u.child_id=$CID AND u.day=CURRENT_DATE AND s.name='youtube'")
[ "${B:-0}" -ge 5000000 ] && ok "5MB attributed to $KID as YouTube (got ${B:-0} bytes)" || bad "bytes not recorded (got '${B:-0}')"
M=$(psql "SELECT used_min FROM service_usage u JOIN services s ON s.id=u.service_id
          WHERE u.child_id=$CID AND u.day=CURRENT_DATE AND s.name='youtube'")
[ "${M:-0}" -ge 1 ] && ok "counted an active minute (above the idle threshold)" || bad "no active minute"

# A trickle must NOT count as active use.
ip netns exec $NS nft add element inet kids svc_youtube_dev "{ 192.168.60.210 counter packets 2 bytes 800 }" 2>/dev/null
NFT_NS=$NS ADGUARD_PASS="${ADGUARD_PASS:-x}" bash "$R/bin/kidnet-servicemeter" >/dev/null 2>&1
M2=$(psql "SELECT used_min FROM service_usage u JOIN services s ON s.id=u.service_id
           WHERE u.child_id=$CID AND u.day=CURRENT_DATE AND s.name='youtube'")
[ "${M2:-0}" = "${M:-0}" ] && ok "a background trickle adds bytes but no active minute" || bad "idle traffic wrongly counted as active"

echo; printf 'passed %d, failed %d\n' "$pass" "$fail"; [ "$fail" = 0 ]
