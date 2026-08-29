-- kids-network logging + policy schema
CREATE TABLE IF NOT EXISTS children (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  age         int,
  policy_tier text NOT NULL DEFAULT 'standard',   -- young | standard | teen
  notes       text
);

CREATE TABLE IF NOT EXISTS policies (
  tier              text PRIMARY KEY,             -- young | standard | teen
  description       text,
  block_categories  text[] NOT NULL DEFAULT '{}',
  safesearch        boolean NOT NULL DEFAULT true,
  youtube_restricted boolean NOT NULL DEFAULT true,
  force_dns         boolean NOT NULL DEFAULT true, -- redirect all :53, block DoH/DoT
  daily_budget_school_min int,                    -- NULL = no quota
  daily_budget_weekend_min int
);

CREATE TABLE IF NOT EXISTS devices (
  id          serial PRIMARY KEY,
  child_id    int REFERENCES children(id) ON DELETE SET NULL,
  label       text,
  mac         macaddr UNIQUE,
  reserved_ip inet UNIQUE,
  kind        text,                               -- phone|tablet|desktop|console|tv|other
  is_active   boolean NOT NULL DEFAULT true,
  first_seen  timestamptz DEFAULT now(),
  last_seen   timestamptz
);

CREATE TABLE IF NOT EXISTS schedules (
  id        serial PRIMARY KEY,
  child_id  int REFERENCES children(id) ON DELETE CASCADE,
  name      text NOT NULL,                        -- 'school-night bedtime', 'homework window'
  days      int[] NOT NULL,                       -- 0=Sun..6=Sat
  start_min int NOT NULL,                         -- minutes from midnight
  end_min   int NOT NULL,
  action    text NOT NULL DEFAULT 'block',        -- block | allow
  enabled   boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS dhcp_leases (
  ip        inet PRIMARY KEY,
  mac       macaddr,
  hostname  text,
  device_id int REFERENCES devices(id) ON DELETE SET NULL,
  starts    timestamptz,
  ends      timestamptz,
  active    boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS dns_log (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  device_id int REFERENCES devices(id) ON DELETE SET NULL,
  client_ip inet,
  domain    text NOT NULL,
  category  text,
  action    text NOT NULL DEFAULT 'allowed'       -- allowed | blocked
);
CREATE INDEX IF NOT EXISTS dns_log_ts_idx ON dns_log (ts DESC);
CREATE INDEX IF NOT EXISTS dns_log_dev_idx ON dns_log (device_id, ts DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  child_id  int REFERENCES children(id) ON DELETE SET NULL,
  device_id int REFERENCES devices(id) ON DELETE SET NULL,
  severity  text NOT NULL DEFAULT 'info',         -- info | warn | urgent
  category  text,
  domain    text,
  detail    text,
  acknowledged boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts (ts DESC);

-- Audit of every on/off action (manual, schedule, agent, dinner-pause)
CREATE TABLE IF NOT EXISTS block_events (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  target_type text NOT NULL,                      -- child | device | all
  target_ref  text,                               -- name/label/ip
  action      text NOT NULL,                      -- off | on
  source      text,                               -- manual | schedule | agent | dinner
  actor       text,
  reason      text
);

-- Domains that must NEVER be blocked, even during 'off' / bedtime.
CREATE TABLE IF NOT EXISTS always_allow (
  id     serial PRIMARY KEY,
  domain text NOT NULL UNIQUE,
  scope  text NOT NULL DEFAULT 'global',
  note   text
);
