#!/usr/bin/env bash
# The ONLY thing Hearth runs on the host: a tiny loop whose single job is to
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
CONTAINER="${GW_CONTAINER:-hearth-gw}"
MAC="$(echo "$KIDS_NIC_MAC" | tr 'A-F' 'a-f')"
# USB path of the adapter, discovered once, used to reset it if it disappears.
USB_PATH="$(for d in /sys/bus/usb/devices/*/; do
    for n in "$d"net/*/; do
      [ -e "$n/address" ] || continue
      [ "$(cat "$n/address" 2>/dev/null)" = "$MAC" ] && { basename "$d"; break 2; }
    done
  done 2>/dev/null)"
[ -n "$USB_PATH" ] && echo "warden: adapter is USB device $USB_PATH (can auto-reset)"

log(){ echo "warden: $*"; }

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
    if [ -n "${USB_PATH:-}" ] && [ -w "/sys/bus/usb/devices/$USB_PATH/authorized" ]; then
      log "NIC missing from host AND container; resetting the USB adapter ($USB_PATH)"
      echo 0 > "/sys/bus/usb/devices/$USB_PATH/authorized" 2>/dev/null
      sleep 2
      echo 1 > "/sys/bus/usb/devices/$USB_PATH/authorized" 2>/dev/null
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
    ( sleep 20; docker restart hearth-adguard >/dev/null 2>&1 ) &
  else
    log "handover FAILED for $IF; retrying shortly"
  fi
  sleep 5
done
