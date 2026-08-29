-- People and device ownership.
--
-- The `children` table is really the PEOPLE table (the name is historical from
-- when it only held kids). `kind` distinguishes household kids from guests and
-- adults, so controls and reporting can scope correctly: "kids off" should not
-- sweep up a visiting friend, and a friend's device should still be visible and
-- controllable so they cannot watch YouTube all night on your wifi.
ALTER TABLE children ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'child';
  -- child | guest | adult
COMMENT ON COLUMN children.kind IS 'child | guest | adult';

-- Readability alias for new code (reads only; writes still go to children).
CREATE OR REPLACE VIEW people AS SELECT * FROM children;

-- Device discovery + ownership.
-- A device first appears from a DHCP lease (MAC, hostname, IP), owned by nobody
-- (child_id NULL = unassigned). The parent labels it ("Ben's Chromebook") and
-- assigns it to a person. Who-owns-what is deliberately manual: only the parent
-- knows whose device is whose.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS hostname text;   -- announced via DHCP
ALTER TABLE devices ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS first_seen timestamptz DEFAULT now();

-- One row per device with owner + assignment status, for the dashboard and CLI.
CREATE OR REPLACE VIEW device_roster AS
SELECT d.id, d.label, d.hostname, d.mac::text AS mac, host(d.reserved_ip) AS ip,
       d.kind AS device_kind, d.is_active, d.last_seen,
       c.id AS person_id, c.name AS person, c.kind AS person_kind, c.policy_tier,
       (c.id IS NULL) AS unassigned
FROM devices d LEFT JOIN children c ON c.id = d.child_id;

GRANT SELECT ON people, device_roster TO kids_app;
