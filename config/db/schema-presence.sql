-- Presence, as distinct from "we have seen this device before".
--
-- last_seen is refreshed from the DHCP lease list, and a lease outlives the
-- device that holds it by up to its full duration. So a phone that left the
-- house in the morning still looked "online" all day, which is misleading in
-- exactly the moment a parent is asking who is home.
--
-- present_at is written only when the gateway can actually see the device on
-- the wire (it is in the neighbour table, meaning it answered ARP recently).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS present_at timestamptz;
-- active_at is stricter: only a neighbour the kernel marks REACHABLE, which
-- means the device answered on the wire moments ago. present_at includes
-- STALE, and a phone that left the house can sit STALE for a long time. The
-- meter charges minutes against active_at, because a minute of budget must
-- mean the device was actually there (2026-09-02: a phone's day-old DHCP
-- lease burned a child's whole budget while it sat in a schoolbag).
ALTER TABLE devices ADD COLUMN IF NOT EXISTS active_at timestamptz;
CREATE INDEX IF NOT EXISTS devices_present_idx ON devices (present_at DESC NULLS LAST);
