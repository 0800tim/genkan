-- A fourth device class: the appliance.
--
-- Some devices are not a person's and are not smart-home kit either: an SMS
-- gateway phone, a build agent, a media server. They need ordinary internet,
-- they should never be caught by a time limit or a "kids off", and calling
-- them "infrastructure" is misleading, because infrastructure means the
-- network's own equipment (the access point, the gateway) which nothing
-- should ever touch.
--
--   personal   belongs to a person, filtered and metered by their tier
--   iot        smart home: locked down, vendor cloud only, never cut
--   appliance  unrestricted device: full internet, no person, no time limits
--   infra      the network's own equipment, never touched by any control
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_category_check;
ALTER TABLE devices ADD CONSTRAINT devices_category_check
  CHECK (category IN ('personal','iot','appliance','infra'));
COMMENT ON COLUMN devices.category IS 'personal | iot | appliance | infra';
