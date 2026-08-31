-- A fifth device class, and the two tick boxes that go with it.
--
-- The problem, in the owner's words: "I've got an iPad that basically all the
-- kids use, and also the smart TVs in that category. We do want to have maybe
-- tick boxes to say that these devices get killed during dinnertime. That can
-- be a button that is just complete outage, all devices off. Obviously, if
-- we've got some appliance devices they wouldn't get included, but kid devices
-- would."
--
-- A television does not belong to one child, and Genkan identifies the device,
-- not the person holding the remote. Until now a family iPad had two homes and
-- both were wrong. Give it to one child and that child pays for the family film
-- out of their own minutes. Give it to nobody and it escapes every budget, every
-- filter tier and every control there is.
--
--   personal   belongs to a person, filtered and metered by their tier
--   shared     belongs to the HOUSEHOLD. Filtered at a level the parent picks,
--              metered against nobody, and swept up by dinner or a whole-house
--              cut only where the parent has ticked the box.
--   iot        smart home: locked down, vendor cloud only, never cut
--   appliance  unrestricted device: full internet, no person, no time limits
--   infra      the network's own equipment, never touched by any control
--
-- Load order: after schema-roles.sql, because it replaces people_in_scope() and
-- ips_in_scope(), and after schema-devices.sql, because it replaces
-- device_roster. Idempotent, like every other file here.

-- ---------------------------------------------------------------------------
-- 1. The class
-- ---------------------------------------------------------------------------
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_category_check;
ALTER TABLE devices ADD CONSTRAINT devices_category_check
  CHECK (category IN ('personal','shared','iot','appliance','infra'));
COMMENT ON COLUMN devices.category IS 'personal | shared | iot | appliance | infra';

-- A shared device is filtered at its own level, because "still filtered, at a
-- level the parent chooses" is the whole reason it is not simply unowned. NULL
-- means no client of its own, which for a family television means it falls
-- through to the household catch-all and gets no adult-content filtering at
-- all. bin/kidnet gives a device 'standard' when it is filed as shared, so the
-- unsafe answer is never the one a parent gets by accident.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS policy_tier text;
COMMENT ON COLUMN devices.policy_tier IS
  'A shared device''s own filter level. NULL on a personal device: that one comes from its owner.';

-- ---------------------------------------------------------------------------
-- 2. The tick boxes
-- ---------------------------------------------------------------------------
-- Two sweeps a parent can point at the house, and one column per sweep saying
-- whether this device is in it.
--
--   dinner     "everyone off while we eat". Kids and shared devices.
--   house off  the whole-house cut: one button, everything ticked for it.
--
-- NULL means "whatever this class defaults to", which is why they are nullable
-- rather than NOT NULL DEFAULT true. It buys two things worth having. Re-filing
-- a device from personal to shared picks up the shared defaults instead of
-- carrying stale ticks across, and the Devices page can honestly say "this is
-- the default" rather than claiming the parent chose it.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS caught_by_dinner boolean;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS caught_by_house_off boolean;
COMMENT ON COLUMN devices.caught_by_dinner IS
  'Ticked: this device goes off at dinner. NULL = the class default. Forced off for iot/appliance/infra.';
COMMENT ON COLUMN devices.caught_by_house_off IS
  'Ticked: this device goes off in a whole-house cut. NULL = the class default. Forced off for iot/appliance/infra.';

-- THE guard, in one place, the way ips_in_scope() is. A device that is smart
-- home, an appliance or infrastructure is in NO sweep, whatever its columns
-- say. Somebody hand-editing the database, a bad migration or a future bug in
-- the dashboard cannot put the front door lock in a dinner pause, because the
-- answer is computed here and nothing else is allowed to answer it.
--
-- The defaults, per class:
--   personal   in both. A child's own device is what these sweeps are for.
--   shared     in both, and the Devices page says so is a default and asks.
--              A whole-house cut that leaves the family television streaming
--              is not a whole-house cut. The parent unticks what they mean to
--              keep (a shared speaker playing music through dinner).
--   iot        in neither, always. The lock, the camera, the vacuum.
--   appliance  in neither, always. The media server, the SMS gateway.
--   infra      in neither, always. The access point is not a client.
CREATE OR REPLACE VIEW device_sweeps AS
SELECT d.id                                   AS device_id,
       coalesce(d.label, d.hostname, 'device '||d.id) AS device,
       d.category,
       d.child_id,
       d.is_active,
       host(d.reserved_ip)                    AS ip,
       CASE WHEN d.category IN ('personal','shared')
            THEN coalesce(d.caught_by_dinner, true) ELSE false END    AS in_dinner,
       CASE WHEN d.category IN ('personal','shared')
            THEN coalesce(d.caught_by_house_off, true) ELSE false END AS in_house_off,
       -- true = nobody has ticked this yet, so the value above is Genkan's
       -- default rather than the parent's answer.
       (d.caught_by_dinner IS NULL)     AS dinner_default,
       (d.caught_by_house_off IS NULL)  AS house_off_default
FROM devices d;

-- ---------------------------------------------------------------------------
-- 3. Block state for a device that belongs to nobody
-- ---------------------------------------------------------------------------
-- category_state is keyed on a child, and the gateway reconciles the firewall
-- from it every fifteen seconds. A shared device has no child, so a block
-- written straight into nftables would be scrubbed on the next tick. This is
-- the same idea, keyed on the device instead, so the firewall stays a
-- projection of the database and nothing depends on a command still running.
CREATE TABLE IF NOT EXISTS device_state (
  device_id int NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  category  text NOT NULL DEFAULT 'internet',
  blocked   boolean NOT NULL DEFAULT false,
  since     timestamptz NOT NULL DEFAULT now(),
  set_by    text,
  PRIMARY KEY (device_id, category)
);
COMMENT ON TABLE device_state IS
  'Block state for a device with no owner (a shared family device). The per-child equivalent is category_state.';

-- ---------------------------------------------------------------------------
-- 4. The whole-house cut
-- ---------------------------------------------------------------------------
-- One row, one timestamp. The house is off while off_until is in the future,
-- and it lifts ITSELF when that moment passes.
--
-- That expiry is the point, not a convenience. The obvious way to build "all
-- devices off" is to write a block against every device, and the obvious way
-- that goes wrong is a parent pressing it on the way out the door and nobody
-- being home to press the other one. A cut that has to be undone by hand is a
-- cut that can outlive the reason for it. This one cannot: no rows are written
-- against any device, the firewall reads the clock through
-- blocked_device_ips, and when off_until passes the addresses simply stop
-- being in the set. Turning it back on early is the same single UPDATE.
CREATE TABLE IF NOT EXISTS house_state (
  only_row  boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  off_until timestamptz,
  off_since timestamptz,
  set_by    text,
  reason    text
);
INSERT INTO house_state (only_row) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW house_status AS
SELECT (h.off_until IS NOT NULL AND h.off_until > now())              AS is_off,
       h.off_until, h.off_since, h.set_by, h.reason,
       GREATEST(0, ceil(EXTRACT(EPOCH FROM (h.off_until - now()))/60))::int AS minutes_left,
       (SELECT count(*) FROM device_sweeps s
         WHERE s.in_house_off AND s.is_active AND s.ip IS NOT NULL)::int    AS devices_caught
FROM house_state h;

-- ---------------------------------------------------------------------------
-- 5. What the firewall should be blocking, all of it, in one place
-- ---------------------------------------------------------------------------
-- gateway/entrypoint.sh reconciles @kids_block to exactly this every fifteen
-- seconds. Three reasons an address is in here, and no others:
--
--   1. it is a person's own device and that person's internet is off
--   2. it is a shared device that has been cut in its own right
--   3. the whole-house cut is running and this device is ticked for it
--
-- Smart home, appliances and infrastructure appear in none of the three. Rule 1
-- gained an explicit category='personal': the old query in entrypoint.sh joined
-- on child_id alone, so a camera that had somehow been handed to a child would
-- have gone dark with them. Nothing in bin/kidnet can produce that row, but the
-- iron rule should not depend on that staying true.
CREATE OR REPLACE VIEW blocked_device_ips AS
  SELECT host(d.reserved_ip) AS ip, 'owner'::text AS why
    FROM devices d
    JOIN category_state cs ON cs.child_id = d.child_id
   WHERE cs.category = 'internet' AND cs.blocked
     AND d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL
  UNION
  SELECT host(d.reserved_ip), 'device'
    FROM devices d
    JOIN device_state ds ON ds.device_id = d.id
   WHERE ds.category = 'internet' AND ds.blocked
     AND d.category = 'shared' AND d.is_active AND d.reserved_ip IS NOT NULL
  UNION
  SELECT s.ip, 'house-off'
    FROM device_sweeps s, house_state h
   WHERE h.off_until IS NOT NULL AND h.off_until > now()
     AND s.in_house_off AND s.is_active AND s.ip IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Scopes
-- ---------------------------------------------------------------------------
-- Two names join the list, and both are about devices as much as people.
--
--   dinner     the same people as 'all' (everybody but the adults, plus a
--              personal device nobody has claimed), PLUS every shared device
--              ticked for dinner. This is what `kidnet dinner` uses.
--   house-off  no people at all: purely every device, personal or shared,
--              ticked for the whole-house cut. It is deliberately NOT in
--              bin/kidnet's SCOPES list, so `kidnet off house-off` is refused.
--              The only door to it is `kidnet house off`, which sets the clock
--              that makes the cut lift itself.
CREATE OR REPLACE FUNCTION people_in_scope(p_scope text)
RETURNS TABLE (id int, name text, role text) LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.kind
  FROM people p
  WHERE p.active
    AND CASE lower(p_scope)
      WHEN 'all'          THEN NOT p.is_adult
      WHEN 'dinner'       THEN NOT p.is_adult
      WHEN 'everyone'     THEN true
      WHEN 'kids'         THEN p.is_kid
      WHEN 'guests'       THEN p.is_guest
      WHEN 'guest-kids'   THEN p.is_guest AND p.is_kid
      WHEN 'guest-adults' THEN p.is_guest AND p.is_adult
      WHEN 'adults'       THEN p.is_adult
      WHEN 'household'    THEN NOT p.is_guest
      -- 'house-off' falls through here and matches nobody, which is correct:
      -- the whole-house cut is per DEVICE, not per person.
      ELSE lower(p.name) = lower(p_scope)
    END
$$;

-- The addresses a scope resolves to. STILL the one guard: nothing here can
-- return an iot, appliance or infra address, because branches 1 and 2 name
-- category='personal' outright and branch 3 reads device_sweeps, which forces
-- those three classes out of every sweep.
CREATE OR REPLACE FUNCTION ips_in_scope(p_scope text)
RETURNS TABLE (ip text) LANGUAGE sql STABLE AS $$
  -- 1. a person's own device, when that person is in the scope. On the two
  --    sweeps the parent's tick still has the last word, so a phone taken out
  --    of the dinner pause stays online through it.
  SELECT host(d.reserved_ip)
  FROM devices d
  JOIN people_in_scope(p_scope) s ON s.id = d.child_id
  LEFT JOIN device_sweeps w ON w.device_id = d.id
  WHERE d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL
    AND CASE lower(p_scope) WHEN 'dinner' THEN w.in_dinner ELSE true END
  UNION
  -- 2. a personal device nobody owns yet. An unnamed tablet at 9pm is far more
  --    likely to be a child's than a visiting grandparent's.
  SELECT host(d.reserved_ip)
  FROM devices d
  LEFT JOIN device_sweeps w ON w.device_id = d.id
  WHERE lower(p_scope) IN ('all','everyone','dinner')
    AND d.child_id IS NULL
    AND d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL
    AND CASE lower(p_scope) WHEN 'dinner' THEN w.in_dinner ELSE true END
  UNION
  -- 3. the sweeps. Dinner takes the shared devices ticked for it; the
  --    whole-house cut takes every device ticked for it, shared or personal,
  --    and reaches no further.
  SELECT w.ip
  FROM device_sweeps w
  WHERE w.is_active AND w.ip IS NOT NULL
    AND ( (lower(p_scope) = 'dinner'    AND w.category = 'shared' AND w.in_dinner)
       OR (lower(p_scope) = 'house-off' AND w.in_house_off) )
$$;

-- ---------------------------------------------------------------------------
-- 7. The roster the dashboard and the CLI read
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS device_roster;
CREATE VIEW device_roster AS
SELECT d.id, d.label, d.hostname, d.mac::text AS mac, host(d.reserved_ip) AS ip,
       d.kind AS device_kind, d.category, d.vendor, d.is_active, d.last_seen,
       c.id AS person_id, c.name AS person, c.kind AS person_kind, c.policy_tier,
       -- A shared device's own filter level, and the one that actually applies.
       d.policy_tier                          AS device_tier,
       coalesce(c.policy_tier, d.policy_tier) AS filter_tier,
       w.in_dinner, w.in_house_off, w.dinner_default, w.house_off_default,
       (c.id IS NULL) AS unassigned
FROM devices d
LEFT JOIN children c    ON c.id = d.child_id
LEFT JOIN device_sweeps w ON w.device_id = d.id;

GRANT SELECT ON device_roster, device_sweeps, blocked_device_ips, house_status TO kids_app;
GRANT SELECT ON house_state TO kids_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_state TO kids_app;
GRANT UPDATE (caught_by_dinner, caught_by_house_off, policy_tier, category) ON devices TO kids_app;
GRANT EXECUTE ON FUNCTION people_in_scope(text) TO kids_app;
GRANT EXECUTE ON FUNCTION ips_in_scope(text) TO kids_app;

-- kids_agent is the least-privilege role bin/kidnet connects as, and it is
-- created by config/db/grants.sql, which loads AFTER this file. Granting here
-- as well, guarded on the role existing, means the order of the two files can
-- never be the reason `kidnet house off` fails with "permission denied".
-- The authoritative list is still the one in grants.sql; these are the same
-- grants, and a GRANT repeated is a no-op.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_agent') THEN
    GRANT SELECT ON device_roster, device_sweeps, blocked_device_ips, house_status TO kids_agent;
    GRANT SELECT, INSERT, UPDATE, DELETE ON device_state TO kids_agent;
    GRANT SELECT, UPDATE ON house_state TO kids_agent;
    GRANT EXECUTE ON FUNCTION people_in_scope(text) TO kids_agent;
    GRANT EXECUTE ON FUNCTION ips_in_scope(text)    TO kids_agent;
  END IF;
END $$;
