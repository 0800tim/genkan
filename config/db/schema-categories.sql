-- Live per-child category blocks, e.g. gaming, social, streaming, all.
-- "kill Ben's gaming" = upsert (Ben,'gaming',true). Cleared when off.
CREATE TABLE IF NOT EXISTS category_state (
  child_id  int REFERENCES children(id) ON DELETE CASCADE,
  category  text NOT NULL,          -- gaming | social | streaming | adult | all | ...
  blocked   boolean NOT NULL DEFAULT false,
  since     timestamptz DEFAULT now(),
  until_ts  timestamptz,            -- optional auto-expiry (e.g. "for 2 hours")
  set_by    text,
  PRIMARY KEY (child_id, category)
);
-- Reference: which domains/keywords define each blockable category.
CREATE TABLE IF NOT EXISTS category_domains (
  category text NOT NULL,
  domain   text NOT NULL,
  PRIMARY KEY (category, domain)
);

-- Per-category metering (METERING.md). These three were created by hand on the
-- first box; they belong here so a fresh deploy builds them too.
--
-- category_ips: "these addresses are gaming/video", learned from DNS answers
-- and TTL'd by `seen`. kidnet-catmeter loads them into the nftables sets.
CREATE TABLE IF NOT EXISTS category_ips (
  ip       inet NOT NULL,
  category text NOT NULL,
  seen     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, category)
);

-- Active minutes counted per child per day per category. One row per minute
-- in which the device moved more than the threshold to that category's
-- addresses, so idle keepalive never registers.
CREATE TABLE IF NOT EXISTS category_usage (
  child_id int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day      date NOT NULL,
  category text NOT NULL,
  used_min int NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day, category)
);

-- The daily cap per category, e.g. 2h gaming, 1h video. Audio, schoolwork and
-- messaging are never given a budget, because they are never metered.
CREATE TABLE IF NOT EXISTS category_budgets (
  child_id  int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  category  text NOT NULL,
  daily_min int NOT NULL,
  PRIMARY KEY (child_id, category)
);

-- The portal and dashboard connect as the limited kids_app role. Reads only:
-- the meter (kidnet-catmeter) and kidnet own every write to these tables.
GRANT SELECT ON category_usage, category_budgets, category_ips TO kids_app;
