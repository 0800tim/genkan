-- ---------------------------------------------------------------------------
-- The slow lane
-- ---------------------------------------------------------------------------
-- A third state between "on" and "off". Instead of cutting a category dead, the
-- gateway polices it down to a few hundred kilobits: the video still plays, it
-- just buffers, and the child drifts off to something else on their own. Nobody
-- was told no, so there is nothing to resent and nothing to argue about.
--
-- This is deliberately NOT a parallel mechanism. The third state lives on
-- category_state, next to the block it replaces, so there is one row per child
-- per category and one place to read:
--
--   blocked = true                 off        (unchanged, still the hard cut)
--   blocked = false, speed 'slow'  slow lane
--   blocked = false, speed 'full'  full speed (the default, unchanged)
--
-- An existing household gets 'full' on every row it already has, so loading
-- this file changes nothing at all until somebody asks for a slow lane.
ALTER TABLE category_state ADD COLUMN IF NOT EXISTS speed text NOT NULL DEFAULT 'full';
ALTER TABLE category_state DROP CONSTRAINT IF EXISTS category_state_speed_ck;
ALTER TABLE category_state ADD CONSTRAINT category_state_speed_ck
  CHECK (speed IN ('full','slow'));
COMMENT ON COLUMN category_state.speed IS
  'full or slow. The third state between on and off: slow is policed down to slow_settings.rate_kbit, never cut.';

-- ---------------------------------------------------------------------------
-- The household's two choices
-- ---------------------------------------------------------------------------
-- rate_kbit  how slow the slow lane is. 256 kbit/s by default: a chat message,
--            a search result and a small page all still arrive, and video
--            cannot hold a stream at any quality. See DECISIONS.md.
--
-- on_timeout what happens when a child runs out of time. 'cut' is what Genkan
--            has always done and stays the default, because changing what
--            happens at zero without a household choosing it would be wrong.
--            'slow' drops them into the slow lane instead: the evening tails
--            off rather than ending mid-sentence. Some families want the
--            cliff, some want the slope. Neither is the right answer for
--            everybody, so neither is assumed.
CREATE TABLE IF NOT EXISTS slow_settings (
  only_row   boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  rate_kbit  int  NOT NULL DEFAULT 256 CHECK (rate_kbit BETWEEN 32 AND 100000),
  on_timeout text NOT NULL DEFAULT 'cut' CHECK (on_timeout IN ('cut','slow')),
  updated    timestamptz NOT NULL DEFAULT now(),
  set_by     text
);
INSERT INTO slow_settings (only_row) VALUES (true) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- What the firewall should be slowing, all of it, in one place
-- ---------------------------------------------------------------------------
-- gateway/entrypoint.sh reconciles @slow_gaming, @slow_video, @slow_social and
-- @slow_all to exactly this every fifteen seconds, the same way it reconciles
-- @kids_block from blocked_device_ips.
--
-- THE IRON RULE APPLIES HERE TOO. d.category = 'personal' is the whole guard:
-- a camera, a smart lock, the fridge or the access point can never appear in
-- this view, so they can never be throttled. A blocked device is excluded as
-- well, because it is already dropped in the filter chain and slowing what is
-- being dropped would only muddy what the firewall says it is doing.
CREATE OR REPLACE VIEW slow_lane_ips AS
  SELECT cs.category, host(d.reserved_ip) AS ip
    FROM category_state cs
    JOIN devices d ON d.child_id = cs.child_id
   WHERE cs.speed = 'slow' AND NOT cs.blocked
     AND d.category = 'personal' AND d.is_active AND d.reserved_ip IS NOT NULL;
COMMENT ON VIEW slow_lane_ips IS
  'Island addresses to police, per category. Personal devices only: smart home, appliances and infrastructure are never throttled.';

-- Which children are on the out-of-time slope rather than the cliff. The meter
-- reads this so it stops spending minutes for a child who has already run out:
-- without it their ledger keeps going further into the red and earning ten
-- minutes back would not lift them out of the slow lane.
CREATE OR REPLACE VIEW slow_lane_children AS
  SELECT cs.child_id, cs.category, cs.set_by, cs.since
    FROM category_state cs
   WHERE cs.speed = 'slow' AND NOT cs.blocked;

-- The portal and the dashboard read all of this and never write it: the slow
-- lane is a parent's decision, taken through kidnet.
GRANT SELECT ON slow_settings, slow_lane_ips, slow_lane_children TO kids_app;
