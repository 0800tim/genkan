#!/usr/bin/env bash
# Genkan gateway supervisor. Runs as PID 1 inside the container.
#
# Lifecycle: wait for the host warden to hand us kids0 -> run the segment
# guard -> configure the interface -> load the firewall -> re-sync block and
# safety-net state from the database -> then watch for the NIC vanishing
# (USB replug) and start over. Never exits: a gateway that dies fail-closed
# takes the island down, and "kids offline, house untouched" is the designed
# worst case, but we still try hard not to get there.
set -u
GW_IP="${KIDS_GW_IP:-192.168.60.1}"
GW_CIDR="${KIDS_GW_CIDR:-24}"
KIDS_NET="${KIDS_SUBNET:-192.168.60.0/24}"
# The gateway has never been a superuser. It connects with KIDS_DB_URL_DOCKER,
# which is the kids_app role (secrets.env), over TCP from inside the container.
# It stays there rather than moving to the CLI's kids_agent role, because
# kids_agent has no password on purpose and so cannot authenticate over TCP at
# all: it is reachable only over the local socket inside the postgres
# container. See config/db/grants.sql.
DB="${KIDS_DB_URL_DOCKER:-}"
# The shipped ruleset, as baked into the image. A variable so the slow lane
# renderer below can be exercised outside a container.
KIDS_NFT="${KIDS_NFT:-/etc/kids.nft}"

log(){ echo "[gateway] $(date -u +%FT%TZ) $*"; }

# Alerts land in the same alerts table the dashboard and voice agent read.
# Non-fatal by design: the firewall must not depend on the database being up.
alert(){ local sev="$1" detail="$2" ack=false
  # Severity is interpolated into SQL, so it is one of three words or nothing.
  # The detail beside it is quote-doubled below; it can carry a tcpdump line or
  # a device label, so it is the one that has always needed the care.
  case "$sev" in info|warn|urgent) ;; *) sev=warn;; esac
  log "ALERT($sev): $detail"
  # Routine informational events (the island coming up) are worth keeping for
  # history but must not sit in a parent's alert queue. Anything worse than
  # info arrives unacknowledged and demands attention.
  [ "$sev" = info ] && ack=true
  [ -n "$DB" ] && timeout 5 psql "$DB" -qc \
    "INSERT INTO alerts(severity,category,detail,acknowledged) VALUES('$sev','gateway','$(echo "$detail" | sed "s/'/''/g")',$ack)" 2>/dev/null
  return 0; }

# Segment guard: refuse to become a gateway on a wire that is already someone
# else's network. Listens briefly for (a) another DHCP server answering, or
# (b) traffic from private subnets that are not ours. Catches the exact
# failure to fear: the access point still bridged to the main house LAN, where our
# DHCP server would fight the real router. Runs on every NIC (re)appearance.
segment_guard(){
  local out rc bad
  # What we are actually guarding against: serving DHCP onto a wire that is
  # ALREADY someone else's network (e.g. the AP still bridged to the house
  # LAN), where our DHCP server would fight the real router.
  #
  # The definitive signal is ANOTHER DHCP SERVER answering (udp SOURCE port
  # 67), or traffic genuinely sourced from a foreign gateway. We deliberately
  # do NOT trip on client ARP for a foreign subnet: a device that still holds a
  # stale lease from the old network broadcasts exactly that, it is harmless,
  # and it renews onto our subnet within minutes. Tripping on it would refuse
  # a perfectly good wire. (Learned the hard way: a Roomba with an old address
  # would have blocked the first real deployment.)
  out=$(timeout 8 tcpdump -Z root -c 1 -i kids0 -nn -q \
        "(udp src port 67) or (ip and not net $KIDS_NET and not net 224.0.0.0/4 and not host 255.255.255.255 and udp src port 53)" \
        2>&1); rc=$?
  if [ "$rc" = 0 ]; then
    bad=$(echo "$out" | grep -v '^tcpdump:\|listening on\|packet' | head -1)
    alert urgent "segment guard TRIPPED on kids0: another DHCP or DNS server is serving this wire ($bad). Refusing to start: is the access point still bridged to the main network?"
    return 1
  fi
  if [ "$rc" != 124 ] || ! echo "$out" | grep -q "listening on kids0"; then
    alert urgent "segment guard CANNOT LISTEN on kids0 (tcpdump rc=$rc: $(echo "$out" | head -1)). Failing closed; island stays down."
    return 1
  fi
  log "segment guard: no competing DHCP/DNS server on this wire, safe to own it"
}

load_firewall(){
  # Replace ONLY our own table. A full `nft flush ruleset` also wipes the NAT
  # rules Docker installs in this namespace for its embedded DNS resolver
  # (127.0.0.11), which silently breaks name resolution inside the container:
  # raw IPs still work, but Postgres by hostname and the safety-net domain
  # lookups both fail. Found the hard way on the first live deploy.
  nft delete table inet kids 2>/dev/null || true
  nft -f /etc/kids.nft || { alert urgent "firewall ruleset failed to load; island stays down (fail closed)"; return 1; }
  log "firewall loaded"
}

# State lives in Postgres; the firewall is a PROJECTION of it, reconciled
# every RECONCILE_S seconds. That is what lets the portal grant earned time
# (it only writes the database; the firewall follows within seconds), and
# what makes restarts and USB replugs unable to forget that a kid is off.
# The rebuild is a single nft -f transaction, so it applies atomically.
RECONCILE_S="${RECONCILE_S:-15}"
# Reconcile one nft set to exactly the rows a query returns. Reads the CURRENT
# elements by parsing ONLY the set's elem array: nft's JSON metainfo carries a
# "version" string that looks like an address and used to poison this
# comparison. Never fails silently: a stale allow-list means devices lose
# internet, which is exactly the outage we are guarding against.
reconcile_set(){
  local setname="$1" query="$2" want current n rows rc=0
  # Ask, and keep the exit status. An empty answer and a FAILED query are not
  # the same thing, and this could not tell them apart: a query that errored
  # (a view this image expects but the database has not been given yet, say)
  # produced no rows, which read as "nothing should be blocked", and the next
  # line flushed @kids_block and handed every cut-off child the internet back.
  # A failed query now changes nothing at all.
  rows=$(timeout 10 psql "$DB" -tAc "$query" 2>/dev/null); rc=$?
  if [ "$rc" != 0 ]; then
    log "reconcile $setname: query failed (rc=$rc), keeping the existing set"
    return 0
  fi
  want=$( { printf '%s\n' "$rows"; printf '%s\n' ${EXTRA_IPS:-}; } \
          | grep -E '^[0-9]+[.]' | sort -u | paste -sd,)
  if [ -z "$want" ] && ! timeout 5 psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
    log "reconcile $setname: database unreachable, keeping the existing set"
    return 0
  fi
  current=$(nft -j list set inet kids "$setname" 2>/dev/null | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
out = []
for blk in d.get("nftables", []):
    st = blk.get("set")
    if not st: continue
    for e in st.get("elem", []) or []:
        el = e.get("elem") if isinstance(e, dict) and "elem" in e else e
        v = el.get("val") if isinstance(el, dict) else el
        if isinstance(v, str): out.append(v)
print(",".join(sorted(set(out))))
' 2>/dev/null)
  [ "$want" = "${current:-}" ] && return 0
  if { echo "flush set inet kids $setname"
       [ -n "$want" ] && echo "add element inet kids $setname { $want }"
       true; } | nft -f - 2>/tmp/nfterr; then
    n=$(echo "$want" | tr ',' ' ' | wc -w)
    log "reconciled $setname -> $n address(es)"
  else
    alert warn "reconcile $setname FAILED ($(head -1 /tmp/nfterr 2>/dev/null)); devices may lose access"
  fi
}

# AdGuard runs in THIS namespace and is the island's DHCP server, so it knows
# about a device the instant it hands out a lease, well before the host-side
# devicescan timer has copied it into Postgres. Reading it directly closes the
# gap where a freshly joined device sits with no internet for up to a minute.
# Best effort: if AdGuard is unreachable we simply fall back to the database.
adguard_lease_ips(){
  [ -n "${ADGUARD_PASS:-}" ] || return 0
  timeout 5 python3 -c "
import os,json,base64,urllib.request
url=os.environ.get('ADGUARD_LOCAL','http://127.0.0.1:3000')+'/control/dhcp/status'
auth=base64.b64encode((os.environ.get('ADGUARD_USER','admin')+':'+os.environ['ADGUARD_PASS']).encode()).decode()
r=urllib.request.Request(url); r.add_header('Authorization','Basic '+auth)
try: d=json.load(urllib.request.urlopen(r,timeout=4))
except Exception: raise SystemExit(0)
for L in (d.get('leases') or [])+(d.get('static_leases') or []):
    ip=L.get('ip')
    if ip: print(ip)
" 2>/dev/null
}

# How slow the slow lane is, in kilobytes per second, taken from the household's
# setting. nftables variables cannot stand where the grammar wants a number, so
# the rate is a literal inside the rules, and changing it means re-rendering
# them. The rules themselves live in ONE place, config/nftables/kids.nft,
# between the two sentinel comments; this lifts that block out of the shipped
# file, substitutes the household's figure and reloads only the throttle chain.
#
# Fails towards FULL SPEED, deliberately. If the render or the reload goes
# wrong the chain is left empty and nobody is throttled, which is the harmless
# direction. The dangerous direction would be a half-applied ruleset that
# slowed the safety net.
slow_rate_installed(){
  nft list chain inet kids throttle 2>/dev/null \
    | sed -n 's/.*limit rate over \([0-9]\+\) kbytes\/second.*/\1/p' | head -1
}
apply_slow_rate(){
  local kbit rate burst have
  nft list chain inet kids throttle >/dev/null 2>&1 || return 0   # older ruleset, nothing to do
  kbit=$(timeout 5 psql "$DB" -tAc "SELECT rate_kbit FROM slow_settings" 2>/dev/null | tr -dc '0-9')
  [ -n "$kbit" ] || return 0                                      # no setting, keep what is loaded
  [ "$kbit" -ge 32 ] 2>/dev/null || kbit=32
  [ "$kbit" -le 100000 ] || kbit=100000
  rate=$(( kbit / 8 )); [ "$rate" -ge 4 ] || rate=4
  burst=$(( rate * 2 ))
  have=$(slow_rate_installed)
  [ "$have" = "$rate" ] && return 0
  { echo "table inet kids {"
    echo "  chain throttle {"
    sed -n '/>>> slow lane rules/,/<<< slow lane rules/p' "$KIDS_NFT" \
      | sed '1d;$d' \
      | sed -e 's/\$KIDS_IF/"kids0"/g' \
            -e "s|limit rate over [0-9]* kbytes/second burst [0-9]* kbytes|limit rate over $rate kbytes/second burst $burst kbytes|g"
    echo "  }"
    echo "}"; } > /tmp/slow-lane.nft
  if nft flush chain inet kids throttle && nft -f /tmp/slow-lane.nft; then
    log "slow lane: ${kbit} kbit/s (${rate} kbytes/s, burst ${burst} kbytes)"
  else
    alert warn "slow lane: could not apply ${kbit} kbit/s. The throttle chain is empty, so nothing is being slowed."
  fi
}

sync_state(){
  [ -n "$DB" ] || return 0
  # KNOWN devices: every active reservation plus every current DHCP lease.
  # Anything not in here gets no internet (the static-IP dodge defence), so
  # this MUST stay current or real devices are locked out.
  EXTRA_IPS="$(adguard_lease_ips)" \
  reconcile_set kids_known "SELECT host(reserved_ip) FROM devices WHERE reserved_ip IS NOT NULL AND is_active
                            UNION SELECT host(ip) FROM dhcp_leases WHERE active"
  # Unclaimed devices, but only when the household has switched claiming on.
  # In 'off' and 'observe' the set stays empty, so the rule in kids.nft is a
  # no-op and nothing changes for a family that has not opted in. Observe
  # restricts nothing on purpose: a parent wants to know how many devices this
  # would catch BEFORE it catches any. See docs/DEVICE-IDENTITY.md.
  reconcile_set kids_unclaimed "SELECT ip FROM unclaimed_devices
     WHERE (SELECT mode FROM claim_settings) = 'enforce'"

  # BLOCKED devices. Three reasons an address is in here and no others: its
  # owner's internet is off, it is a shared family device cut in its own right,
  # or the whole-house cut is running and this device is ticked for it. The
  # query lives in the database now (blocked_device_ips, schema-shared.sql), so
  # the firewall, bin/kidnet and the dashboard cannot disagree about who is cut.
  #
  # Two things that query does which the old one here did not. It requires
  # category='personal' on the owner branch, so a camera that had somehow been
  # handed to a child cannot go dark with them. And it reads the clock on the
  # whole-house cut, so that cut expires on its own: nobody has to be home to
  # undo it, and there is no state left behind to go stale.
  reconcile_set kids_block "SELECT ip FROM blocked_device_ips"

  # THE SLOW LANE. Same idea as the block above, and the same three guarantees:
  # the database is the desired state, a failed query changes nothing, and the
  # view it reads (slow_lane_ips, config/db/schema-slow.sql) yields PERSONAL
  # devices only, so a camera or a smart lock can never be throttled.
  #
  # A set that is empty costs nothing: the rules in kids.nft match against it
  # and fall straight through, so a household that has never asked for a slow
  # lane pays nothing for it being there.
  reconcile_set slow_gaming "SELECT ip FROM slow_lane_ips WHERE category='gaming'"
  reconcile_set slow_video  "SELECT ip FROM slow_lane_ips WHERE category='video'"
  reconcile_set slow_social "SELECT ip FROM slow_lane_ips WHERE category='social'"
  reconcile_set slow_all    "SELECT ip FROM slow_lane_ips WHERE category='internet'"
  # Where "social" is, learned from DNS answers exactly like gaming and video.
  # genkan-catmeter fills the other three destination sets on its own minute
  # timer; social has no meter, so it is filled here.
  reconcile_set social_ips "SELECT host(ip) FROM category_ips
     WHERE category='social' AND seen > now() - interval '24 hours'"

  apply_slow_rate
}

# Resolve the scope='safety' always_allow domains (NZ youth help lines,
# schoolwork) into @kids_allow so they survive a cut. Same rules as
# `kidnet allow-sync` on the host; both may run, both converge.
# The Tor relay list. Reconciled here rather than in sync_state because it is
# thousands of addresses that change once a day, and diffing that every fifteen
# seconds would be work for nothing.
#
# It reads the database like every other set, which is the whole point of the
# change: genkan-tor-sync used to write a file and an nft snippet that nothing
# ever applied, so @tor_nodes was empty for the life of the box while the daily
# job reported success. A set the firewall rebuilds from Postgres cannot drift
# out of force, because a restart puts it back rather than losing it.
sync_tor_nodes(){
  [ -n "$DB" ] || return 0
  # reconcile_set already fails towards keeping what is loaded: a query that
  # errors, or a database that is not answering, changes nothing at all. That
  # is the safe direction here too. An empty tor_nodes table is a household
  # that has not fetched the list yet, not an instruction to unblock Tor, and
  # it cannot be told from a fetch that failed, so it is left to say so in
  # genkan-health rather than acted on.
  reconcile_set tor_nodes "SELECT host(ip) FROM tor_nodes"
}

sync_safety_net(){
  [ -n "$DB" ] || return 0
  local d ip list="" ips
  for d in $(timeout 5 psql "$DB" -tAc "SELECT domain FROM always_allow WHERE scope='safety'" 2>/dev/null); do
    for ip in $(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}'); do
      case "$ip" in 0.0.0.0|127.*) continue;; esac
      list="$list$ip\n"
    done
  done
  ips=$(printf "%b" "$list" | sort -u | paste -sd,)
  if [ -n "$ips" ]; then
    nft flush set inet kids kids_allow
    nft add element inet kids kids_allow "{ $ips }"
    log "safety net: $(printf "%b" "$list" | sort -u | grep -c .) addresses loaded"
  else
    alert warn "safety net: resolved 0 addresses; help-line allowlist is EMPTY until next sync"
  fi
}

configured=0
last_sync=$(printf '%(%s)T' -1)
last_reconcile=0
trap 'log "shutting down"; exit 0' TERM INT
log "gateway starting; waiting for the warden to hand over kids0"
while true; do
  if ! ip link show kids0 >/dev/null 2>&1; then
    if [ "$configured" = 1 ]; then
      alert warn "kids0 vanished (USB replug or dongle failure); island is down until it returns"
      configured=0
    fi
    sleep 2; continue
  fi
  if [ "$configured" = 0 ]; then
    ip link set kids0 up
    if ! segment_guard; then sleep 60; continue; fi
    ip addr replace "$GW_IP/$GW_CIDR" dev kids0
    load_firewall || { sleep 30; continue; }
    # sync_tor_nodes belongs here as much as in the hourly pass. load_firewall
    # has just reloaded kids.nft, which leaves @tor_nodes empty, and last_sync
    # starts at now, so without this line every restart would leave an hour
    # with no Tor block in it. That hole is the same shape as the bug this all
    # exists to fix, just shorter.
    sync_state; sync_safety_net; sync_tor_nodes; last_reconcile=$(printf '%(%s)T' -1)
    # Coming up healthy supersedes any earlier gateway alarm (a failed segment
    # guard, a vanished NIC, a reconcile error). Clear them, or the dashboard
    # keeps showing a solved problem as if it were happening now.
    if [ -n "$DB" ]; then
      timeout 5 psql "$DB" -qc "UPDATE alerts SET acknowledged=true
        WHERE category='gateway' AND NOT acknowledged AND severity<>'info'" >/dev/null 2>&1 || true
    fi
    alert info "island is UP on kids0 ($GW_IP/$GW_CIDR)"
    configured=1
  fi
  now=$(printf '%(%s)T' -1)
  if [ "$configured" = 1 ]; then
    # Continuous reconcile: DB is the desired state, firewall follows.
    if [ $((now - last_reconcile)) -ge "$RECONCILE_S" ]; then sync_state; last_reconcile=$now; fi
    # Hourly safety-net refresh: help-line addresses are CDN-hosted and move.
    # The Tor relay list rides the same hour: it changes daily, not by the second.
    if [ $((now - last_sync)) -ge 3600 ]; then sync_safety_net; sync_tor_nodes; last_sync=$now; fi
  fi
  sleep 5
done
