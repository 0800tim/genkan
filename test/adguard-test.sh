#!/usr/bin/env bash
# Proves the DNS-layer enforcement (kidnet -> AdGuard) against a running
# AdGuard container. Needs the island stack up (docker compose --profile
# island up -d) and ADGUARD_PASS set. Uses AdGuard's check_host API, which
# evaluates rules exactly as real DNS queries do, keyed by client IP.
set -u
# A suite that cannot run its own tools must say so, not report green.
for _t in curl python3 docker; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
: "${ADGUARD_URL:=http://127.0.0.1:8853}" "${ADGUARD_USER:=admin}" "${ADGUARD_PASS:?set ADGUARD_PASS}"
KN="$(dirname "$0")/../bin"
pass=0; fail=0
reason(){ curl -s -u "$ADGUARD_USER:$ADGUARD_PASS" "$ADGUARD_URL/control/filtering/check_host?name=$1&client=$2" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('reason'))"; }
want(){ local r; r=$(reason "$1" "$2"); if [ "$r" = "$3" ]; then pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s (%s)\n' "$4" "$r"
  else fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s: wanted %s got %s\n' "$4" "$3" "$r"; fi; }
psql(){ docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"; }

# The tiers are applied by AdGuard CLIENT, and a client matches by the IPs of
# the devices actually assigned to that child. So the fixture has to assign a
# device, not just assume an address maps to a kid: that assumption silently
# broke once the placeholder children were renamed and unassigned.
KID1=$(psql "SELECT name FROM children WHERE kind='child' ORDER BY id LIMIT 1")
KID3=$(psql "SELECT name FROM children WHERE kind='child' ORDER BY id DESC LIMIT 1")
psql "INSERT INTO devices(mac,label,child_id,reserved_ip,kind,category,is_active,last_seen)
      VALUES('fe:ed:00:00:00:01','adgtest-kid1',(SELECT id FROM children WHERE name='$KID1'),'192.168.60.241','phone','personal',true,now())
      ON CONFLICT (mac) DO UPDATE SET child_id=(SELECT id FROM children WHERE name='$KID1'), reserved_ip='192.168.60.241', is_active=true" >/dev/null
psql "INSERT INTO devices(mac,label,child_id,reserved_ip,kind,category,is_active,last_seen)
      VALUES('fe:ed:00:00:00:03','adgtest-kid3',(SELECT id FROM children WHERE name='$KID3'),'192.168.60.243','phone','personal',true,now())
      ON CONFLICT (mac) DO UPDATE SET child_id=(SELECT id FROM children WHERE name='$KID3'), reserved_ip='192.168.60.243', is_active=true" >/dev/null
"$KN/genkan-adguard-clients" >/dev/null 2>&1

# Hermetic: clear ALL category blocks, then block gaming+video for the first child.
# The test restores nothing else, so run it on a resting system.
psql "UPDATE category_state SET blocked=false WHERE blocked" >/dev/null
psql "INSERT INTO category_state(child_id,category,blocked,set_by)
      SELECT id,'gaming',true,'adgtest' FROM children WHERE name='$KID1'
      UNION ALL SELECT id,'video',true,'adgtest' FROM children WHERE name='$KID1'
      ON CONFLICT(child_id,category) DO UPDATE SET blocked=true,set_by='adgtest'" >/dev/null
"$KN/genkan-adguard" apply >/dev/null; sleep 2

echo "DNS-layer enforcement (child-11=.101 gaming+video blocked; child-16=.121 clear)"
want fortnite.com    192.168.60.241 RewriteRule           "11 gaming -> portal"
want googlevideo.com 192.168.60.241 RewriteRule           "11 video -> portal"
want spotify.com     192.168.60.241 NotFilteredNotFound   "11 audio stays up"
want fortnite.com    192.168.60.243 NotFilteredNotFound   "16 gaming allowed"
want 1737.org.nz     192.168.60.241 NotFilteredWhiteList  "11 helpline wins"
want khanacademy.org 192.168.60.241 NotFilteredWhiteList  "11 schoolwork wins"
want pornhub.com     192.168.60.241 FilteredBlackList     "11 adult blocked"
want pornhub.com     192.168.60.243 FilteredBlackList     "16 adult blocked"

# Unblock and confirm it clears.
psql "UPDATE category_state SET blocked=false WHERE set_by='adgtest'" >/dev/null
"$KN/genkan-adguard" apply >/dev/null; sleep 2
want fortnite.com 192.168.60.241 NotFilteredNotFound "11 gaming restored after unblock"

psql "DELETE FROM category_state WHERE set_by='adgtest'" >/dev/null
# Remove the fixture devices and put AdGuard's clients back as they were.
psql "DELETE FROM devices WHERE label LIKE 'adgtest-%'" >/dev/null
"$KN/genkan-adguard-clients" >/dev/null 2>&1
"$KN/genkan-adguard" apply >/dev/null 2>&1
echo; printf 'passed %d, failed %d\n' "$pass" "$fail"; [ "$fail" = 0 ]
