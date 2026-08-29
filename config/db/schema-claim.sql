-- Device claiming: an unrecognised device is restricted until somebody says
-- whose it is. See docs/DEVICE-IDENTITY.md for why this is claiming rather
-- than logging in.
--
-- Load order: after schema-devices.sql (it references devices) and after
-- schema-people.sql (it references children).

-- Off by default. A household running happily today must not wake up with
-- devices in a restricted lane because they pulled an update.
CREATE TABLE IF NOT EXISTS claim_settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  mode     text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','observe','enforce')),
  need_pin boolean NOT NULL DEFAULT false,
  updated  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO claim_settings (only_row) VALUES (true) ON CONFLICT DO NOTHING;

-- The optional per-child PIN. Stored as a digest, not a number, because a
-- child with database access is exactly the adversary this is aimed at. NULL
-- means this child has no PIN and can claim without one.
ALTER TABLE children ADD COLUMN IF NOT EXISTS claim_pin text;

-- A device bound by a self-claim that no parent has confirmed. It STAYS in the
-- restricted lane while this is true.
--
-- An earlier draft let a pending device run at the house's tightest filter
-- level instead. That does not work, because a time budget belongs to a child,
-- not to a device: a younger child claiming the eldest's name would still
-- inherit her clock, and in this household the eldest has no daily limit at
-- all. Unlimited time was exactly the prize worth lying for.
--
-- Staying restricted removes the prize entirely. A claim is a request that a
-- parent grants, so naming the wrong sibling gains nothing and costs the liar
-- the wait they were trying to skip.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS claim_pending boolean NOT NULL DEFAULT false;

-- Who claimed what, and when. Kept even after the device is reassigned,
-- because "my phone claimed itself as Toby at 2am" is the interesting row.
CREATE TABLE IF NOT EXISTS device_claims (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  mac        macaddr,
  ip         inet,
  child_id   int REFERENCES children(id) ON DELETE SET NULL,
  hostname   text,
  outcome    text NOT NULL CHECK (outcome IN ('claimed','wrong-pin','refused')),
  source     text NOT NULL DEFAULT 'portal'
);
CREATE INDEX IF NOT EXISTS device_claims_ts ON device_claims(ts DESC);

-- A personal device nobody has claimed. Deliberately narrow: smart home kit,
-- infrastructure and appliances are the household's and are never expected to
-- announce themselves, so they must not be swept into the restricted lane.
CREATE OR REPLACE VIEW unclaimed_devices AS
SELECT d.id, d.mac::text AS mac, d.hostname, d.label,
       host(d.reserved_ip) AS ip, d.last_seen
  FROM devices d
 WHERE (d.child_id IS NULL OR d.claim_pending)
   AND coalesce(d.category,'personal') = 'personal'
   AND coalesce(d.kind,'') NOT IN ('ap','infra','gateway')
   AND d.reserved_ip IS NOT NULL
   AND d.is_active;

GRANT SELECT, INSERT, UPDATE ON claim_settings TO kids_app;
GRANT SELECT, INSERT ON device_claims TO kids_app;
GRANT USAGE, SELECT ON SEQUENCE device_claims_id_seq TO kids_app;
GRANT SELECT ON unclaimed_devices TO kids_app;
GRANT UPDATE (child_id, claim_pending) ON devices TO kids_app;
