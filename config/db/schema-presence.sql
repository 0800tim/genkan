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
CREATE INDEX IF NOT EXISTS devices_present_idx ON devices (present_at DESC NULLS LAST);
