#!/usr/bin/env bash
# The ONLY thing Genkan runs on the host: a tiny loop whose single job is to
# find the kids' USB NIC (by MAC, from config.env) and hand it into the
# gateway container's network namespace. Everything else, addresses, firewall,
# DHCP, DNS, lives inside the container and cannot touch the host.
#
# It re-runs the handover whenever either side disappears: USB replug returns
# the NIC to the host (the kernel does that when a namespace dies, and on
# physical hot-add), and a container restart creates a fresh namespace.
set -u
CONF="${KIDS_CONF:-/etc/kids-network/config.env}"
. "$CONF" || { echo "warden: cannot read $CONF" >&2; exit 1; }
: "${KIDS_NIC_MAC:?KIDS_NIC_MAC must be set in config.env}"
CONTAINER="${GW_CONTAINER:-genkan-gw}"
MAC="$(echo "$KIDS_NIC_MAC" | tr 'A-F' 'a-f')"
log(){ echo "warden: $*"; }

# USB path of the adapter, used to reset it if it disappears. Discovered by
# MAC, which only works while the netdev is visible on the host. It is also
# written to a file, because the moment this matters most is the one where
# discovery fails: the warden restarted (a deploy does that) while the NIC
# was in a container namespace that had just been destroyed, so it was in
# neither place, the path came back empty, and the loop below had no way to
# reset the adapter. That left a household off the air until somebody
# replugged the dongle. Seen on 2026-08-31; the file is the fix.
USB_PATH_FILE="${KIDS_STATE_DIR:-/var/lib/genkan}/kids-nic-usb-path"
find_usb_path(){
  local d n
  for d in /sys/bus/usb/devices/*/; do
    for n in "$d"net/*/; do
      [ -e "$n/address" ] || continue
      [ "$(cat "$n/address" 2>/dev/null)" = "$MAC" ] && { basename "$d"; return 0; }
    done
  done 2>/dev/null
  return 1
}
USB_PATH="$(find_usb_path || true)"
if [ -n "$USB_PATH" ]; then
  log "adapter is USB device $USB_PATH (can auto-reset)"
  printf '%s\n' "$USB_PATH" > "$USB_PATH_FILE" 2>/dev/null || true
elif [ -s "$USB_PATH_FILE" ]; then
  USB_PATH="$(tr -d ' \t\r\n' < "$USB_PATH_FILE")"
  log "adapter not visible right now; last seen as USB device $USB_PATH (can auto-reset)"
fi

host_iface_by_mac(){
  local d
  for d in /sys/class/net/*; do
    [ -e "$d/address" ] || continue
    if [ "$(cat "$d/address")" = "$MAC" ]; then basename "$d"; return 0; fi
  done
  return 1
}

while true; do
  PID=$(docker inspect -f '{{.State.Pid}}' "$CONTAINER" 2>/dev/null)
  if [ -z "${PID:-}" ] || [ "$PID" = 0 ]; then sleep 5; continue; fi
  # Already inside the container? Nothing to do.
  if nsenter -t "$PID" -n ip link show kids0 >/dev/null 2>&1; then sleep 5; continue; fi
  if ! IF=$(host_iface_by_mac); then
    # The NIC is in neither the host nor the container. USB ethernet adapters
    # can vanish like this when a container namespace is destroyed (the device
    # does not always return to the default namespace). A driver-level reset
    # brings it straight back, which beats waiting for a human to replug it.
    # The path found by MAC is the interface (2-6.2:1.0); the reset goes to
    # the device above it (2-6.2), because de-authorising only the interface
    # was seen to leave the netdev missing while the device reset brought it
    # straight back.
    DEV="${USB_PATH%%:*}"
    if [ -n "${USB_PATH:-}" ] && [ -w "/sys/bus/usb/devices/$DEV/authorized" ]; then
      log "NIC missing from host AND container; resetting the USB adapter ($DEV)"
      echo 0 > "/sys/bus/usb/devices/$DEV/authorized" 2>/dev/null
      sleep 3
      echo 1 > "/sys/bus/usb/devices/$DEV/authorized" 2>/dev/null
      sleep 5
    fi
    sleep 5; continue
  fi
  log "handing $IF ($MAC) to container $CONTAINER (pid $PID) as kids0"
  ip link set "$IF" down 2>/dev/null
  if ip link set "$IF" netns "$PID" name kids0; then
    log "handover done; the container's entrypoint takes it from here"
    # AdGuard binds DHCP to kids0 by name at startup and does not retry, so
    # give it a fresh start now that the interface actually exists. Waits
    # briefly for the gateway to finish the segment guard + configure.
    ( sleep 20; docker restart genkan-adguard >/dev/null 2>&1 ) &
  else
    log "handover FAILED for $IF; retrying shortly"
  fi
  sleep 5
done
