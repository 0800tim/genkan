#!/usr/bin/env bash
# Proves the household roles: who a scoped control catches, and who it does not.
#
# The scenario this exists for, in the owner's words: "If I turn off streaming
# at 11pm, it turns it off for all the kids, including guests, but leaves the
# adult guests streaming."
#
# It is hermetic. It creates its own people (prefixed rtest-) and its own
# devices on unused addresses, asserts, then deletes every one of them and puts
# the category blocks it touched back the way it found them. It never asserts
# anything about the real family, so it is safe to run on a live box.
#
# The firewall half runs in a throwaway network namespace with its own copy of
# the kids_block set, so the live gateway is never written to. That also means
# the test works on a box where the island is not deployed.
#
# Run: sudo test/roles-test.sh     (sudo only for the network namespace)
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
KN="$R/bin/kidnet"
NS=hearth-roletest
pass=0; fail=0
ok(){  pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"; }
# want <label> <expected> <actual>
want(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: wanted [$2] got [$3]"; fi; }
has(){    case " $3 " in *" $2 "*) ok "$1";; *) bad "$1: [$2] missing from [$3]";; esac; }
hasnt(){  case " $3 " in *" $2 "*) bad "$1: [$2] should NOT be in [$3]";; *) ok "$1";; esac; }

# --- the throwaway firewall ------------------------------------------------
# kidnet talks to nft through the gateway container by default. NFT_DIRECT=1
# plus an NFT wrapper points it at our namespace instead.
WRAP=$(mktemp); chmod +x "$WRAP"
cat > "$WRAP" <<W
#!/bin/sh
exec ip netns exec $NS /usr/sbin/nft "\$@"
W
kn(){ NFT_DIRECT=1 NFT="$WRAP" bash "$KN" "$@"; }
# What is in the block set right now. nft wraps a long element list over
# several lines, so flatten it before reading it.
blockset(){ ip netns exec $NS /usr/sbin/nft list set inet kids kids_block 2>/dev/null \
  | tr '\n' ' ' | sed -n 's/.*elements = { \(.*\) }.*/\1/p' | tr -d ','; }

cleanup(){
  psql "DELETE FROM devices WHERE mac::text LIKE 'fe:ed:%'" >/dev/null 2>&1
  psql "DELETE FROM children WHERE name LIKE 'rtest%'" >/dev/null 2>&1
  # Put the family's category blocks back exactly as they were.
  [ -f "$SNAP" ] && psql "$(cat "$SNAP")" >/dev/null 2>&1
  ip netns del $NS 2>/dev/null
  rm -f "$WRAP" "$SNAP"
}
SNAP=$(mktemp)
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo (it needs a network namespace)"; exit 1; }

# Snapshot every current block as one restoring statement, before we touch it.
psql "SELECT coalesce(
  'UPDATE category_state SET blocked=false; '||string_agg(
    format('UPDATE category_state SET blocked=true WHERE child_id=%s AND category=%L;',
           child_id, category), ' '),
  'UPDATE category_state SET blocked=false;')
  FROM category_state WHERE blocked" > "$SNAP"

ip netns del $NS 2>/dev/null
ip netns add $NS
ip netns exec $NS /usr/sbin/nft add table inet kids
ip netns exec $NS /usr/sbin/nft add set inet kids kids_block "{ type ipv4_addr; }"
ip netns exec $NS /usr/sbin/nft add set inet kids kids_allow "{ type ipv4_addr; }"

# --- the household ---------------------------------------------------------
echo
echo "Setting up: two household kids, a visiting kid, a visiting grandparent, a household adult"
mkperson(){ bash "$KN" person add "$1" "$2" >/dev/null; }
mkdev(){ # mac ip owner label class
  psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,is_active,last_seen,child_id)
        VALUES('$1','$4','$2','phone','$5',true,now(),
               (SELECT id FROM children WHERE name='$3'))
        ON CONFLICT (mac) DO UPDATE SET reserved_ip='$2', category='$5', is_active=true,
               child_id=(SELECT id FROM children WHERE name='$3')" >/dev/null; }

mkperson rtestKid    child
mkperson rtestKid2   child
mkperson rtestVisKid guest-child
mkperson rtestNana   guest-adult
mkperson rtestDad    adult

mkdev fe:ed:00:11:00:01 192.168.60.211 rtestKid    'rtest kid phone'      personal
mkdev fe:ed:00:11:00:02 192.168.60.212 rtestKid2   'rtest kid2 tablet'    personal
mkdev fe:ed:00:11:00:03 192.168.60.213 rtestVisKid 'rtest visitor phone'  personal
mkdev fe:ed:00:11:00:04 192.168.60.214 rtestNana   'rtest nana tablet'    personal
mkdev fe:ed:00:11:00:05 192.168.60.215 rtestDad    'rtest dad phone'      personal
# A smart lock. Nobody's device, and it must survive every control there is.
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,is_active,last_seen)
      VALUES('fe:ed:00:11:00:06','rtest smart lock','192.168.60.216','lock','iot',true,now())
      ON CONFLICT (mac) DO UPDATE SET category='iot', reserved_ip='192.168.60.216'" >/dev/null
# The access point.
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,is_active,last_seen)
      VALUES('fe:ed:00:11:00:07','rtest AP','192.168.60.217','ap','infra',true,now())
      ON CONFLICT (mac) DO UPDATE SET category='infra', reserved_ip='192.168.60.217'" >/dev/null

# --- 1. who each scope resolves to -----------------------------------------
echo
echo "1. Scopes: who is in each group"
scope(){ psql "SELECT string_agg(name,' ' ORDER BY name) FROM people_in_scope('$1') WHERE name LIKE 'rtest%'"; }
want "kids = household kids + visiting kids"      "rtestKid rtestKid2 rtestVisKid" "$(scope kids)"
want "guests = the visiting kid and the visiting adult" "rtestNana rtestVisKid"    "$(scope guests)"
want "guest-adults = the visiting adult only"     "rtestNana"                      "$(scope guest-adults)"
want "adults = household adult + visiting adult"  "rtestDad rtestNana"             "$(scope adults)"
want "household = the people who live here"       "rtestDad rtestKid rtestKid2"    "$(scope household)"

# --- 2. the addresses a scope reaches --------------------------------------
echo
echo "2. Addresses: IoT and infrastructure are in no scope at all"
ips(){ psql "SELECT string_agg(ip,' ' ORDER BY ip) FROM ips_in_scope('$1') WHERE ip LIKE '192.168.60.21%'"; }
KIDIPS=$(ips kids); ALLIPS=$(ips all); EVERY=$(ips everyone)
has    "kids reaches the visiting kid"      192.168.60.213 "$KIDIPS"
hasnt  "kids does not reach the visiting adult" 192.168.60.214 "$KIDIPS"
hasnt  "kids does not reach the household adult" 192.168.60.215 "$KIDIPS"
for s in all everyone kids guests adults household guest-kids guest-adults; do
  L=$(ips $s)
  hasnt "the smart lock is not in scope '$s'"   192.168.60.216 "$L"
  hasnt "the access point is not in scope '$s'" 192.168.60.217 "$L"
done
hasnt "'all' leaves the household adult alone"  192.168.60.215 "$ALLIPS"
has   "'everyone' does reach the household adult" 192.168.60.215 "$EVERY"

# --- 3. the 11pm scenario --------------------------------------------------
echo
echo "3. 11pm: streaming off for the kids, guest kids included, adult guests untouched"
kn media off kids >/dev/null
blocked(){ psql "SELECT blocked FROM category_state cs JOIN children c ON c.id=cs.child_id
                 WHERE c.name='$1' AND cs.category='$2'"; }
want "household kid: video blocked"     t "$(blocked rtestKid video)"
want "household kid: social blocked"    t "$(blocked rtestKid social)"
want "visiting kid: video blocked"      t "$(blocked rtestVisKid video)"
want "visiting grandparent: no video block" "" "$(blocked rtestNana video)"
want "household adult: no video block"      "" "$(blocked rtestDad video)"
kn media on kids >/dev/null
want "and back on again for the visiting kid" f "$(blocked rtestVisKid video)"

# --- 4. the same, at the firewall ------------------------------------------
echo
echo "4. The firewall agrees: 'off kids' cuts the visiting kid, not the grandparent"
kn off kids >/dev/null 2>&1
SET=$(blockset)
has   "visiting kid's phone is blocked"        192.168.60.213 "$SET"
has   "household kid's phone is blocked"       192.168.60.211 "$SET"
hasnt "grandparent's tablet is NOT blocked"    192.168.60.214 "$SET"
hasnt "household adult's phone is NOT blocked" 192.168.60.215 "$SET"
hasnt "the smart lock is NOT blocked"          192.168.60.216 "$SET"
hasnt "the access point is NOT blocked"        192.168.60.217 "$SET"
kn on kids >/dev/null 2>&1
SET=$(blockset)
hasnt "'on kids' lets the visiting kid back"   192.168.60.213 "$SET"

echo
echo "   and a dinner pause (scope 'all')"
kn dinner >/dev/null 2>&1
SET=$(blockset)
has   "dinner cuts the visiting kid"           192.168.60.213 "$SET"
hasnt "dinner leaves the grandparent alone"    192.168.60.214 "$SET"
hasnt "dinner leaves the smart lock alone"     192.168.60.216 "$SET"
kn resume >/dev/null 2>&1

# --- 5. the guest goes home ------------------------------------------------
echo
echo "5. The guest goes home"
kn off rtestVisKid >/dev/null 2>&1
kn guest leave rtestVisKid >/dev/null 2>&1
SET=$(blockset)
hasnt "nothing of theirs is left blocked"      192.168.60.213 "$SET"
want  "their device has no owner"     "" "$(psql "SELECT child_id FROM devices WHERE mac::text='fe:ed:00:11:00:03'")"
want  "they are out of every scope"   ""  "$(scope kids | tr -d ' ' | sed 's/rtestKidrtestKid2//')"
want  "the household kids are untouched" "rtestKid rtestKid2" "$(scope kids)"
kn guest back rtestVisKid >/dev/null 2>&1
want  "and they are in scope again when they come back" "rtestKid rtestKid2 rtestVisKid" "$(scope kids)"

# --- 6. household adults are never swept up --------------------------------
echo
echo "6. An adult is only ever reached on purpose"
for s in kids all guests guest-kids; do
  L=$(ips $s)
  hasnt "'$s' does not reach the household adult" 192.168.60.215 "$L"
done

echo
printf '%s\n' "roles-test: $pass passed, $fail failed"
[ "$fail" = 0 ]
