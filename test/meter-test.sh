#!/usr/bin/env bash
# Proves per-category active-time metering + budget enforcement, no hardware.
# Loads the real ruleset in a netns, injects synthetic per-device byte counters
# (standing in for real traffic), runs kidnet-catmeter against that netns, and
# checks category_usage ticks and that a child over budget gets the category
# blocked (music/schoolwork untouched).
set -u
R="$(cd "$(dirname "$0")/.." && pwd)"
NS=metertest
pass=0; fail=0
ok(){ pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad(){ fail=$((fail+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
psql(){ docker exec -i postgres psql -U postgres -d kids_network -tAc "$1"; }
cleanup(){ ip netns del $NS 2>/dev/null
  psql "DELETE FROM category_usage WHERE child_id=1 AND day=CURRENT_DATE" >/dev/null
  psql "UPDATE category_state SET blocked=false,set_by='reset' WHERE child_id=1 AND category IN ('gaming','video')" >/dev/null
  psql "DELETE FROM devices WHERE label='meter-test-dev'" >/dev/null
  psql "DELETE FROM category_budgets WHERE child_id=1 AND category='gaming' AND daily_min<>120" >/dev/null; }
trap cleanup EXIT
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
cleanup

ip netns add $NS
ip netns exec $NS nft -f "$R/config/nftables/kids.nft"
# child-1 device at .101; give child-1 a small gaming budget for the test
psql "INSERT INTO devices(child_id,label,reserved_ip,kind,is_active) VALUES(1,'meter-test-dev','192.168.60.101','console',true) ON CONFLICT (reserved_ip) DO UPDATE SET child_id=1,is_active=true,label='meter-test-dev'" >/dev/null
psql "INSERT INTO category_budgets(child_id,category,daily_min) VALUES(1,'gaming',3) ON CONFLICT (child_id,category) DO UPDATE SET daily_min=3" >/dev/null

meter(){ NFT_NS=$NS GAMING_THRESH=1000 VIDEO_THRESH=1000 ADGUARD_PASS="${ADGUARD_PASS:-x}" bash "$R/bin/kidnet-catmeter" >/dev/null 2>&1; }
inject(){ # <bytes> into gaming_dev for .101
  ip netns exec $NS nft add element inet kids gaming_dev "{ 192.168.60.101 counter packets 5 bytes $1 }" 2>/dev/null; }

echo "Per-category metering"
# minute 1: heavy gaming traffic -> +1 gaming minute
inject 500000; meter
u=$(psql "SELECT used_min FROM category_usage WHERE child_id=1 AND category='gaming' AND day=CURRENT_DATE")
[ "$u" = 1 ] && ok "1 active minute counted for gaming" || bad "gaming minute (got '$u')"
# minute 2: idle (below threshold) -> no tick
inject 200; meter
u=$(psql "SELECT used_min FROM category_usage WHERE child_id=1 AND category='gaming' AND day=CURRENT_DATE")
[ "$u" = 1 ] && ok "idle minute does NOT count" || bad "idle wrongly counted (got '$u')"
# minutes 3-4: heavy again -> reach budget of 3, then block
inject 500000; meter
inject 500000; meter
u=$(psql "SELECT used_min FROM category_usage WHERE child_id=1 AND category='gaming' AND day=CURRENT_DATE")
blk=$(psql "SELECT blocked FROM category_state WHERE child_id=1 AND category='gaming'")
[ "$u" -ge 3 ] && ok "reached the gaming budget ($u/3 min)" || bad "usage short (got '$u')"
[ "$blk" = t ] && ok "gaming BLOCKED at budget (set_by over-budget)" || bad "gaming not blocked (blk='$blk')"
setby=$(psql "SELECT set_by FROM category_state WHERE child_id=1 AND category='gaming'")
[ "$setby" = "over-budget" ] && ok "block reason is over-budget" || bad "reason '$setby'"
# video never touched
vblk=$(psql "SELECT coalesce(blocked,false) FROM category_state WHERE child_id=1 AND category='video'")
[ "$vblk" != "t" ] && ok "video untouched (only gaming hit its budget)" || bad "video wrongly blocked"

# grant clears the over-budget gaming block, raises the budget, video untouched
KIDNAME=$(psql "SELECT name FROM children WHERE id=1")
NFT_NS=$NS ADGUARD_PASS="${ADGUARD_PASS:-x}" bash "$R/bin/kidnet" grant "$KIDNAME" gaming 20 >/dev/null 2>&1
gblk=$(psql "SELECT blocked FROM category_state WHERE child_id=1 AND category='gaming'")
[ "$gblk" = f ] && ok "grant cleared the over-budget gaming block" || bad "grant did not unblock gaming (blk='$gblk')"
newb=$(psql "SELECT daily_min FROM category_budgets WHERE child_id=1 AND category='gaming'")
[ "$newb" -gt 3 ] && ok "grant raised the gaming budget ($newb min)" || bad "budget not raised (got '$newb')"

echo; printf 'passed %d, failed %d\n' "$pass" "$fail"; [ "$fail" = 0 ]
