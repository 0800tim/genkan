-- Device classification. Every device falls into one of three CLASSES, which
-- decides how it is treated:
--   personal   a person's phone/tablet/laptop/console. Assignable to a person,
--              filtered and metered by their tier.
--   iot        smart-home kit: cameras, locks, speakers, vacuums, fridges,
--              lights. Belongs to the household, never assigned to a kid, never
--              metered, and NEVER cut by "kids off" (you do not want the front
--              door lock or the security camera going dark at bedtime).
--   infra      the access point, gateway, switches. Not a client at all.
-- `kind` is the specific type (echo, camera, vacuum, phone, ap, ...); `category`
-- is the class above; `vendor` is the manufacturer guessed from the MAC/hostname.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'personal';
  -- personal | iot | infra
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vendor text;
COMMENT ON COLUMN devices.category IS 'personal | iot | infra';

-- Keep the roster view in step (add category + vendor).
DROP VIEW IF EXISTS device_roster;
CREATE VIEW device_roster AS
SELECT d.id, d.label, d.hostname, d.mac::text AS mac, host(d.reserved_ip) AS ip,
       d.kind AS device_kind, d.category, d.vendor, d.is_active, d.last_seen,
       c.id AS person_id, c.name AS person, c.kind AS person_kind, c.policy_tier,
       (c.id IS NULL) AS unassigned
FROM devices d LEFT JOIN children c ON c.id = d.child_id;
GRANT SELECT ON device_roster TO kids_app;
