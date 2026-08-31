-- Household roles: who is in the house, and what that means for the controls.
--
-- The problem this solves, in the owner's words: "My parents are visiting right
-- now, and I should be able to assign them as adult guests and child guests. If
-- my friend's kids come over, I can just assign them as kids' guests. That way,
-- if I turn off streaming at 11pm, it turns it off for all the kids, including
-- guests, but leaves the adult guests streaming."
--
-- So one column is not enough. `children.kind` used to be child | guest | adult,
-- where "guest" could mean a visiting grandparent or a visiting eight year old,
-- and the controls could not tell them apart. It now carries FOUR roles:
--
--   child        a household kid. Age tier, daily time budget, learn to earn,
--                counted in the weekly digest. Caught by every kids' control.
--   guest-child  a friend's kid, here for the afternoon. Filtered like a child
--                and caught by every kids' control, but has no time budget of
--                their own, earns nothing, and is left out of the family's
--                numbers. Nothing about them survives their visit.
--   guest-adult  a visiting parent or grandparent. Malware and adult content
--                only, no time limit, and NEVER caught by a kids' control.
--   adult        a household adult. Effectively unrestricted.
--
-- Two facts fall out of the role, and every scoped control is written in terms
-- of them rather than in terms of the role itself:
--
--   is_kid    child or guest-child      -> "off kids" catches you
--   is_guest  guest-child or guest-adult -> "off guests" catches you, and you
--                                           are excluded from budgets, earning
--                                           and the weekly digest
--
-- Devices are a separate question and always have been: only category='personal'
-- devices are ever touched by a people-scoped control. The smart lock, the
-- camera and the access point are the household's, not a person's, and a
-- bedtime cut must never darken them. That guard lives in ONE place now, the
-- ips_in_scope() function at the bottom of this file, so there is no second
-- copy of it to forget about.
--
-- Idempotent, like every other file here: safe to run again on a live box.

-- ---------------------------------------------------------------------------
-- 1. The vocabulary
-- ---------------------------------------------------------------------------
-- `active` lets a guest be put away without deleting them and without their
-- history vanishing mid-visit. An inactive person is in no scope at all.
ALTER TABLE children ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
-- When a guest arrived, and when they were shown out. Both NULL for household
-- members, who did not arrive and are not leaving.
ALTER TABLE children ADD COLUMN IF NOT EXISTS arrived timestamptz;
ALTER TABLE children ADD COLUMN IF NOT EXISTS departed timestamptz;

COMMENT ON COLUMN children.kind IS 'child | guest-child | guest-adult | adult';
COMMENT ON COLUMN children.active IS 'false = a guest who has gone home; in no control scope';

-- Migrate the old two-way split. A plain "guest" was only ever created for a
-- visiting friend of the kids, and the guest policy tier says as much ("For a
-- visiting friend"), so it becomes a guest-child. A visiting grandparent has to
-- be said out loud, because the whole point of the change is that the two are
-- not the same thing.
UPDATE children SET kind='guest-child' WHERE kind='guest';

-- Guard the vocabulary in the database, not only in the tools. Written as a DO
-- block because ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS, and because a
-- row with a role we do not recognise must produce a warning a human can act on
-- rather than a half-applied schema file.
DO $$
DECLARE bad int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='children_kind_ck') THEN RETURN; END IF;
  SELECT count(*) INTO bad FROM children
   WHERE kind NOT IN ('child','guest-child','guest-adult','adult');
  IF bad > 0 THEN
    RAISE WARNING 'children.kind has % row(s) with a role Genkan does not know; leaving the check constraint off. Fix them, then run this file again.', bad;
  ELSE
    ALTER TABLE children ADD CONSTRAINT children_kind_ck
      CHECK (kind IN ('child','guest-child','guest-adult','adult'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The filter levels the roles lean on
-- ---------------------------------------------------------------------------
-- 'guest' already existed for visitors. 'adult' is new: a household adult is
-- not on a kid tier, and pointing them at 'teen' (which is what person add used
-- to do) quietly gave a grown adult a child's filter and a child's row in the
-- reports.
INSERT INTO policies (tier, description, block_categories, safesearch, youtube_restricted,
                      force_dns, daily_budget_school_min, daily_budget_weekend_min) VALUES
 ('adult','Household adult: no filtering beyond the household blocklists, no SafeSearch, no time limit. Never caught by a kids'' control.',
   ARRAY[]::text[], false, false, true, NULL, NULL)
ON CONFLICT (tier) DO NOTHING;

-- Make sure the guest tier exists even on a box that never seeded it, and say
-- plainly what it is for. Adult guests sit here.
INSERT INTO policies (tier, description, block_categories, safesearch, youtube_restricted,
                      force_dns, daily_budget_school_min, daily_budget_weekend_min) VALUES
 ('guest','Visitors: malware and adult content only, no time limit, no logging of individuals.',
   ARRAY['adult','malware']::text[], false, false, true, NULL, NULL)
ON CONFLICT (tier) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. People, with the two facts every control is written against
-- ---------------------------------------------------------------------------
-- `people` was a bare SELECT * alias for children. It keeps every column it had
-- and gains the role flags, so nothing that read it before reads differently.
-- The two views built on top of it go first, so re-running this file on a box
-- that already has them does not trip over the dependency.
DROP VIEW IF EXISTS people_devices;
DROP VIEW IF EXISTS household_roster;
DROP VIEW IF EXISTS people;
CREATE VIEW people AS
SELECT c.*,
       c.kind AS role,
       CASE c.kind
         WHEN 'child'       THEN 'Child'
         WHEN 'guest-child' THEN 'Guest child'
         WHEN 'guest-adult' THEN 'Guest adult'
         WHEN 'adult'       THEN 'Adult'
         ELSE c.kind
       END                                        AS role_label,
       (c.kind IN ('child','guest-child'))        AS is_kid,
       (c.kind IN ('guest-child','guest-adult'))  AS is_guest,
       (c.kind IN ('adult','guest-adult'))        AS is_adult,
       -- "one of ours": budgets, earning, goals and the weekly digest are for
       -- household children only. A visiting kid is filtered, not enrolled.
       (c.kind = 'child')                         AS is_household_child
FROM children c;

-- One row per person per personal device: the only rows a people-scoped control
-- is ever allowed to touch. IoT and infrastructure are filtered out here, once.
CREATE VIEW people_devices AS
SELECT p.id AS person_id, p.name, p.kind AS role, p.role_label,
       p.is_kid, p.is_guest, p.is_adult, p.active,
       d.id AS device_id, coalesce(d.label, d.hostname, 'device '||d.id) AS device,
       host(d.reserved_ip) AS ip, d.mac::text AS mac, d.last_seen
FROM people p
JOIN devices d ON d.child_id = p.id
WHERE d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Scopes
-- ---------------------------------------------------------------------------
-- The named groups a parent can point a control at. Everything in bin/kidnet
-- goes through these two functions, so "who does 'kids' mean" is answered in
-- exactly one place and the answer is the same for the firewall, the DNS layer
-- and the dashboard.
--
--   all           everybody except adults, plus devices nobody has claimed yet.
--                 This is what dinner and bedtime use. An unclassified device
--                 is still cut, because it might be a kid's; an adult's is not.
--   everyone      literally every personal device, adults included. The
--                 emergency switch, and the only scope that touches an adult.
--   kids          child + guest-child. The 11pm scope.
--   guests        guest-child + guest-adult.
--   guest-kids    guest-child only.
--   guest-adults  guest-adult only.
--   adults        adult + guest-adult.
--   household     everyone who lives here (child + adult), no visitors.
--   <name>        one person.
--
-- Inactive people (a guest who has gone home) are in no scope.
CREATE OR REPLACE FUNCTION people_in_scope(p_scope text)
RETURNS TABLE (id int, name text, role text) LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.kind
  FROM people p
  WHERE p.active
    AND CASE lower(p_scope)
      WHEN 'all'          THEN NOT p.is_adult
      WHEN 'everyone'     THEN true
      WHEN 'kids'         THEN p.is_kid
      WHEN 'guests'       THEN p.is_guest
      WHEN 'guest-kids'   THEN p.is_guest AND p.is_kid
      WHEN 'guest-adults' THEN p.is_guest AND p.is_adult
      WHEN 'adults'       THEN p.is_adult
      WHEN 'household'    THEN NOT p.is_guest
      ELSE lower(p.name) = lower(p_scope)
    END
$$;

-- The addresses a scope resolves to. THE guard: category='personal' only, so no
-- scope can ever reach the smart lock, the camera, the speaker or the AP.
--
-- 'all' and 'everyone' also take in personal devices nobody owns yet, because
-- an unnamed tablet at 9pm is far more likely to be a child's than a visiting
-- grandparent's, and the alternative is a bedtime that quietly misses it.
CREATE OR REPLACE FUNCTION ips_in_scope(p_scope text)
RETURNS TABLE (ip text) LANGUAGE sql STABLE AS $$
  SELECT host(d.reserved_ip)
  FROM devices d
  JOIN people_in_scope(p_scope) s ON s.id = d.child_id
  WHERE d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL
  UNION
  SELECT host(d.reserved_ip)
  FROM devices d
  WHERE lower(p_scope) IN ('all','everyone')
    AND d.child_id IS NULL
    AND d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- 5. Who is in the house right now, for the dashboard
-- ---------------------------------------------------------------------------
CREATE VIEW household_roster AS
SELECT p.id, p.name, p.age, p.kind AS role, p.role_label, p.policy_tier,
       p.is_kid, p.is_guest, p.is_adult, p.is_household_child, p.active,
       p.arrived, p.departed,
       (SELECT count(*) FROM devices d WHERE d.child_id = p.id)::int AS devices,
       (SELECT count(*) FROM devices d
         WHERE d.child_id = p.id AND d.category='personal' AND d.is_active
           AND d.last_seen > now() - interval '5 minutes')::int AS devices_online
FROM people p;

-- The dashboard and portal read as the limited kids_app role.
GRANT SELECT ON people, people_devices, household_roster TO kids_app;
GRANT EXECUTE ON FUNCTION people_in_scope(text) TO kids_app;
GRANT EXECUTE ON FUNCTION ips_in_scope(text) TO kids_app;
