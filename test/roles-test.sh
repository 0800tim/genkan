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
# A suite that cannot run its own tools must say so, not report green.
for _t in nft python3 docker; do
  command -v "$_t" >/dev/null || { echo "MISSING REQUIRED TOOL: $_t"; exit 1; }
done
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
  psql "DELETE FROM device_state WHERE device_id IN
        (SELECT id FROM devices WHERE mac::text LIKE 'fe:ed:%')" >/dev/null 2>&1
  psql "DELETE FROM devices WHERE mac::text LIKE 'fe:ed:%'" >/dev/null 2>&1
  psql "DELETE FROM children WHERE name LIKE 'rtest%'" >/dev/null 2>&1
  # The whole-house cut, back exactly as it was found. It would expire on its
  # own within the minute this test asks for, but a suite must not leave the
  # house in a state it did not find it in even for that long.
  [ -f "$HSNAP" ] && psql "$(cat "$HSNAP")" >/dev/null 2>&1
  # Put the family's category blocks back exactly as they were.
  [ -f "$SNAP" ] && psql "$(cat "$SNAP")" >/dev/null 2>&1
  ip netns del $NS 2>/dev/null
  rm -f "$WRAP" "$SNAP" "$HSNAP"
}
SNAP=$(mktemp); HSNAP=$(mktemp)
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo (it needs a network namespace)"; exit 1; }

# Snapshot every current block as one restoring statement, before we touch it.
psql "SELECT 'UPDATE house_state SET off_until='||
  coalesce(quote_literal(off_until::text)||'::timestamptz','NULL')||
  ', off_since='||coalesce(quote_literal(off_since::text)||'::timestamptz','NULL')||';'
  FROM house_state" > "$HSNAP"

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
# A media server. Nobody's, unrestricted, and in no sweep either.
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,is_active,last_seen)
      VALUES('fe:ed:00:11:00:08','rtest media server','192.168.60.218','other','appliance',true,now())
      ON CONFLICT (mac) DO UPDATE SET category='appliance', reserved_ip='192.168.60.218'" >/dev/null
# The shared family devices, and the exact pair the owner described: a lounge
# television that should go off at dinner, and a speaker playing music that
# should not. Both belong to the household, neither belongs to a child, and
# neither can ever spend a child's minutes.
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,policy_tier,is_active,last_seen,
                          caught_by_dinner,caught_by_house_off)
      VALUES('fe:ed:00:11:00:09','rtest lounge TV','192.168.60.219','tv','shared','teen',true,now(),NULL,NULL)
      ON CONFLICT (mac) DO UPDATE SET category='shared', reserved_ip='192.168.60.219',
        policy_tier='teen', caught_by_dinner=NULL, caught_by_house_off=NULL, child_id=NULL" >/dev/null
psql "INSERT INTO devices(mac,label,reserved_ip,kind,category,policy_tier,is_active,last_seen,
                          caught_by_dinner,caught_by_house_off)
      VALUES('fe:ed:00:11:00:10','rtest kitchen speaker','192.168.60.220','speaker','shared','standard',true,now(),false,true)
      ON CONFLICT (mac) DO UPDATE SET category='shared', reserved_ip='192.168.60.220',
        policy_tier='standard', caught_by_dinner=false, caught_by_house_off=true, child_id=NULL" >/dev/null

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
# Only ever this suite's own fixtures, which sit on .211 to .220. Never a real
# address, so nothing here can assert anything about the actual household.
ips(){ psql "SELECT string_agg(ip,' ' ORDER BY ip) FROM ips_in_scope('$1')
             WHERE ip LIKE '192.168.60.21%' OR ip = '192.168.60.220'"; }
KIDIPS=$(ips kids); ALLIPS=$(ips all); EVERY=$(ips everyone)
has    "kids reaches the visiting kid"      192.168.60.213 "$KIDIPS"
hasnt  "kids does not reach the visiting adult" 192.168.60.214 "$KIDIPS"
hasnt  "kids does not reach the household adult" 192.168.60.215 "$KIDIPS"
for s in all everyone kids guests adults household guest-kids guest-adults dinner house-off; do
  L=$(ips $s)
  hasnt "the smart lock is not in scope '$s'"    192.168.60.216 "$L"
  hasnt "the access point is not in scope '$s'"  192.168.60.217 "$L"
  hasnt "the media server is not in scope '$s'"  192.168.60.218 "$L"
done
hasnt "'all' leaves the household adult alone"  192.168.60.215 "$ALLIPS"
has   "'everyone' does reach the household adult" 192.168.60.215 "$EVERY"

# --- 2b. shared family devices ---------------------------------------------
echo
echo "2b. Shared family devices: the household's, and swept only where ticked"
DIN=$(ips dinner); HOFF=$(ips house-off)
has   "dinner catches the lounge TV"                 192.168.60.219 "$DIN"
hasnt "dinner leaves the speaker playing music"      192.168.60.220 "$DIN"
has   "dinner still catches the household kid"       192.168.60.211 "$DIN"
has   "dinner still catches the visiting kid"        192.168.60.213 "$DIN"
hasnt "dinner leaves the visiting grandparent alone" 192.168.60.214 "$DIN"
hasnt "dinner leaves the household adult alone"      192.168.60.215 "$DIN"
has   "the whole-house cut catches the lounge TV"    192.168.60.219 "$HOFF"
has   "the whole-house cut catches the speaker"      192.168.60.220 "$HOFF"
has   "the whole-house cut catches the adult's phone" 192.168.60.215 "$HOFF"
# The tick has the last word on a personal device too.
psql "UPDATE devices SET caught_by_house_off=false WHERE mac::text='fe:ed:00:11:00:05'" >/dev/null
hasnt "a phone unticked for the whole-house cut is left out" 192.168.60.215 "$(ips house-off)"
psql "UPDATE devices SET caught_by_house_off=NULL WHERE mac::text='fe:ed:00:11:00:05'" >/dev/null
# A shared device belongs to nobody, so nobody's minutes can pay for it.
want  "the lounge TV has no owner" "" "$(psql "SELECT child_id FROM devices WHERE mac::text='fe:ed:00:11:00:09'")"
want  "and it is not in anybody's people_devices" "0" \
      "$(psql "SELECT count(*) FROM people_devices WHERE ip='192.168.60.219'")"
want  "and the meter cannot see it" "0" \
      "$(psql "SELECT count(*) FROM devices d JOIN children c ON c.id=d.child_id
               WHERE d.mac::text='fe:ed:00:11:00:09'")"
# It is filtered in its own right, which is the other half of the deal.
want  "it carries its own filter level" "teen" \
      "$(psql "SELECT policy_tier FROM devices WHERE mac::text='fe:ed:00:11:00:09'")"

# --- 2c. the tick boxes from the command line ------------------------------
echo
echo "2c. The tick boxes: kidnet sweep, and what it refuses"
kn sweep 192.168.60.219 dinner off >/dev/null 2>&1
hasnt "unticking the TV takes it out of the dinner scope" 192.168.60.219 "$(ips dinner)"
kn sweep 192.168.60.219 dinner default >/dev/null 2>&1
has   "and 'default' puts it back where its class says"   192.168.60.219 "$(ips dinner)"
kn sweep fe:ed:00:11:00:09 house off >/dev/null 2>&1
hasnt "it can be untimed by MAC as well as by address"    192.168.60.219 "$(ips house-off)"
kn sweep 192.168.60.219 house default >/dev/null 2>&1
# The three classes that are in no sweep are refused rather than quietly
# accepted, so a parent is never told they changed something they did not.
for d in 192.168.60.216 192.168.60.217 192.168.60.218; do
  if kn sweep "$d" dinner on >/dev/null 2>&1
    then bad "kidnet sweep accepted a tick on $d, which is in no sweep"
    else ok  "kidnet sweep refuses a tick on $d"; fi
done
# Filing a device as shared takes it off whoever had it, which is the whole
# point: a family iPad that stays somebody's keeps eating that child's minutes.
kn shared 192.168.60.212 'rtest family tablet' standard >/dev/null 2>&1
want  "filing a device as shared takes it off its owner" "" \
      "$(psql "SELECT child_id FROM devices WHERE mac::text='fe:ed:00:11:00:02'")"
want  "and gives it a filter level of its own" "standard" \
      "$(psql "SELECT policy_tier FROM devices WHERE mac::text='fe:ed:00:11:00:02'")"
has   "and it is caught by dinner from then on" 192.168.60.212 "$(ips dinner)"
# Put it back, so the sections after this still describe the household they say
# they do.
psql "UPDATE devices SET category='personal', policy_tier=NULL,
      child_id=(SELECT id FROM children WHERE name='rtestKid2')
      WHERE mac::text='fe:ed:00:11:00:02'" >/dev/null

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
hasnt "dinner leaves the media server alone"   192.168.60.218 "$SET"
has   "dinner cuts the shared lounge TV"       192.168.60.219 "$SET"
hasnt "dinner leaves the speaker playing"      192.168.60.220 "$SET"
# The gateway rebuilds the firewall from the database every fifteen seconds, so
# a block that is only in nftables is a block that lasts fifteen seconds. The
# shared TV has no owner and so no category_state row: this proves its block is
# recorded where the reconciler will find it.
has   "the TV's cut is in the database, so the reconciler keeps it" \
      192.168.60.219 "$(psql "SELECT string_agg(ip,' ') FROM blocked_device_ips")"
kn resume >/dev/null 2>&1
SET=$(blockset)
hasnt "resume brings the lounge TV back"       192.168.60.219 "$SET"
want  "and nothing is left cut in the database" "0" \
      "$(psql "SELECT count(*) FROM blocked_device_ips WHERE ip='192.168.60.219'")"

# --- 4b. the whole-house cut -----------------------------------------------
echo
echo "4b. The whole-house cut: one button, and it lifts itself"
kn house off 1 >/dev/null 2>&1
SET=$(blockset)
has   "it cuts the household kid"              192.168.60.211 "$SET"
has   "it cuts the household adult"            192.168.60.215 "$SET"
has   "it cuts the shared TV"                  192.168.60.219 "$SET"
has   "it cuts the speaker as well"            192.168.60.220 "$SET"
hasnt "it leaves the smart lock alone"         192.168.60.216 "$SET"
hasnt "it leaves the access point alone"       192.168.60.217 "$SET"
hasnt "it leaves the media server alone"       192.168.60.218 "$SET"
want  "the house says it is off"               "t" "$(psql "SELECT is_off FROM house_status")"
# Nothing is written against any device, so there is nothing to go stale.
want  "no device carries a house-off block of its own" "0" \
      "$(psql "SELECT count(*) FROM device_state WHERE set_by='house-off'")"
# The expiry is the point: a cut nobody is home to undo must undo itself.
psql "UPDATE house_state SET off_until=now()-interval '1 second'" >/dev/null
want  "when the clock runs out the house is on again" "f" "$(psql "SELECT is_off FROM house_status")"
want  "and the firewall's desired state is empty again" "0" \
      "$(psql "SELECT count(*) FROM blocked_device_ips")"
kn house on >/dev/null 2>&1
SET=$(blockset)
hasnt "and 'house on' clears the addresses too" 192.168.60.211 "$SET"
# Ending a house cut must not hand the internet back to somebody who was
# already switched off for another reason.
kn off rtestKid >/dev/null 2>&1
kn house off 1 >/dev/null 2>&1
kn house on >/dev/null 2>&1
SET=$(blockset)
has   "a kid who was already off stays off through a house cut and back"  192.168.60.211 "$SET"
hasnt "while everybody else comes back"        192.168.60.215 "$SET"
kn on rtestKid >/dev/null 2>&1

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
