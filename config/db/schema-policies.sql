-- Household security policy: what each IoT device is allowed to do.
--
-- The problem this solves, in one sentence: a security camera must be able to
-- PUSH OUT to its vendor's cloud, so remote recording and the theft backup keep
-- working, while nothing on the internet can reach IN to it and it cannot roam
-- around the household network.
--
-- The unit of policy is therefore DIRECTION, not "allowed" or "blocked":
--
--   internet_out             may this device start a conversation with the
--                            internet, and if so with whom
--                              none   nothing outbound at all
--                              vendor only its own vendor's cloud
--                              full   the ordinary internet
--   inbound_from_wan         may the internet start a conversation with it.
--                            Normally false. NAT already makes this very hard,
--                            but "very hard" is not a policy, so it is written
--                            down and enforced explicitly.
--   talk_to_iot              may it start a conversation with another smart
--                            device (lateral movement). Normally false: this is
--                            how one compromised gadget becomes five.
--   talk_to_personal         may IT start a conversation with a phone, tablet or
--                            laptop. Normally false.
--   reachable_from_personal  may a phone start a conversation with IT. Normally
--                            TRUE, because that is how you view your own camera
--                            from your own sofa, and a design that breaks it is
--                            a design a household will simply switch off.
--
-- Replies are never re-judged: the enforcement chain accepts established and
-- related traffic first, so "the camera may talk out" automatically means "the
-- cloud may answer", and "my phone may reach the camera" means the video comes
-- back. Only the FIRST packet of a conversation is policed.
--
-- Layers, most general first, each one overriding the last:
--   device_class_policy   the shipped default for a KIND (camera, lock, ...)
--   device_policy         the parent's override for ONE device
--   device_access_grants  "this phone may reach that camera", surgical
--
-- Nothing in this file enforces anything. bin/kidnet-iot-policy reads
-- device_policy_effective and generates the nftables sets and chain, the same
-- way kidnet-servicemeter generates its own. See docs/HOUSEHOLD-SECURITY.md.

-- ---------------------------------------------------------------------------
-- Vendor clouds: where a locked-down device is allowed to phone home.
-- ---------------------------------------------------------------------------
-- Honest limit, stated here because it is the weakest joint in the design:
-- these are DOMAINS, resolved to addresses. A vendor on a big shared CDN means
-- the allowlist covers a slice of that CDN, not just the vendor. It still stops
-- the camera talking to an arbitrary host in another country, which is the
-- attack that matters, but it is a fence, not a vault.
CREATE TABLE IF NOT EXISTS vendor_clouds (
  id     serial PRIMARY KEY,
  vendor text NOT NULL UNIQUE,        -- canonical name, e.g. 'Reolink'
  label  text NOT NULL,
  common boolean NOT NULL DEFAULT false,  -- allowed for EVERY locked device
  note   text
);
COMMENT ON COLUMN vendor_clouds.common IS
  'true = allowed for every vendor-restricted device (time sync, certificate checks)';

-- Domain suffixes belonging to a vendor cloud. Matched as a suffix, longest
-- match wins, exactly like service_domains.
CREATE TABLE IF NOT EXISTS vendor_domains (
  vendor_id int NOT NULL REFERENCES vendor_clouds(id) ON DELETE CASCADE,
  domain    text NOT NULL,
  PRIMARY KEY (vendor_id, domain)
);

-- Addresses learned for a vendor cloud, by resolving vendor_domains and by
-- reading our own DNS answers. TTL'd by `seen`, the same pattern as
-- category_ips and service_ips.
CREATE TABLE IF NOT EXISTS vendor_ips (
  ip        inet NOT NULL,
  vendor_id int NOT NULL REFERENCES vendor_clouds(id) ON DELETE CASCADE,
  seen      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, vendor_id)
);
CREATE INDEX IF NOT EXISTS vendor_ips_seen ON vendor_ips(seen);

-- devices.vendor is a guess from the MAC prefix or the hostname, so it does not
-- always read like the canonical name. Aliases map whatever the classifier
-- wrote onto a real cloud, and give a parent a one-row way to say "this thing
-- is a Reolink".
CREATE TABLE IF NOT EXISTS vendor_aliases (
  alias     text PRIMARY KEY,         -- compared case-insensitively
  vendor_id int NOT NULL REFERENCES vendor_clouds(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Per-CLASS defaults: the shipped opinion about each kind of device.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_class_policy (
  kind                    text PRIMARY KEY,     -- matches devices.kind
  label                   text NOT NULL,
  internet_out            text NOT NULL DEFAULT 'vendor',
  inbound_from_wan        boolean NOT NULL DEFAULT false,
  talk_to_iot             boolean NOT NULL DEFAULT false,
  talk_to_personal        boolean NOT NULL DEFAULT false,
  reachable_from_personal boolean NOT NULL DEFAULT true,
  note                    text
);

-- ---------------------------------------------------------------------------
-- Per-DEVICE override. NULL in a column means "inherit the class default", so
-- a parent can change one thing about one camera without restating the rest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_policy (
  device_id               int PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  internet_out            text,
  inbound_from_wan        boolean,
  talk_to_iot             boolean,
  talk_to_personal        boolean,
  reachable_from_personal boolean,
  vendor_id               int REFERENCES vendor_clouds(id) ON DELETE SET NULL,
  note                    text,
  set_by                  text,
  updated_ts              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Surgical exceptions: "Mum's phone may reach the front door camera", and
-- nothing else may. Used when a household turns reachable_from_personal off
-- and wants a short list back rather than the whole house.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_access_grants (
  id            serial PRIMARY KEY,
  src_device_id int NOT NULL REFERENCES devices(id) ON DELETE CASCADE,  -- the phone
  dst_device_id int NOT NULL REFERENCES devices(id) ON DELETE CASCADE,  -- the camera
  note          text,
  set_by        text,
  created_ts    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src_device_id, dst_device_id)
);

-- ---------------------------------------------------------------------------
-- One row of settings, so switching enforcement on is a deliberate act.
-- ---------------------------------------------------------------------------
--   off      generate nothing; remove the chain if it is there
--   observe  generate the chain with COUNTERS in place of every deny, so a
--            parent can see exactly what would break before it breaks. This is
--            the shipped default: installing the schema must never change how
--            a live household's devices behave.
--   enforce  the denies are real
CREATE TABLE IF NOT EXISTS iot_policy_settings (
  id                  int PRIMARY KEY DEFAULT 1,
  mode                text NOT NULL DEFAULT 'observe',
  vendor_ip_ttl_hours int NOT NULL DEFAULT 72,
  updated_ts          timestamptz NOT NULL DEFAULT now(),
  set_by              text
);
INSERT INTO iot_policy_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Vocabulary guarded in the database, not only in the tools, so a stray write
-- cannot leave a policy the generator does not know how to render. Added
-- separately and guarded, because ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='device_class_policy_out_ck') THEN
    ALTER TABLE device_class_policy ADD CONSTRAINT device_class_policy_out_ck
      CHECK (internet_out IN ('none','vendor','full'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='device_policy_out_ck') THEN
    ALTER TABLE device_policy ADD CONSTRAINT device_policy_out_ck
      CHECK (internet_out IS NULL OR internet_out IN ('none','vendor','full'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='iot_policy_settings_mode_ck') THEN
    ALTER TABLE iot_policy_settings ADD CONSTRAINT iot_policy_settings_mode_ck
      CHECK (mode IN ('off','observe','enforce'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='iot_policy_settings_one_ck') THEN
    ALTER TABLE iot_policy_settings ADD CONSTRAINT iot_policy_settings_one_ck CHECK (id = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='device_access_grants_self_ck') THEN
    ALTER TABLE device_access_grants ADD CONSTRAINT device_access_grants_self_ck
      CHECK (src_device_id <> dst_device_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The resolved policy: class defaults, overridden per device, with the vendor
-- cloud worked out. This is the ONE thing bin/kidnet-iot-policy reads.
-- ---------------------------------------------------------------------------
-- Only category='iot' devices appear. Personal devices are governed by the
-- kid-facing layers (time, categories, the safety net) and infrastructure (the
-- access point) is never policed at all: a rule that can darken the AP takes
-- the whole island with it.
DROP VIEW IF EXISTS device_policy_effective;
CREATE VIEW device_policy_effective AS
SELECT d.id                                   AS device_id,
       coalesce(d.label, d.hostname, 'device '||d.id) AS name,
       host(d.reserved_ip)                    AS ip,
       d.kind,
       d.vendor                               AS guessed_vendor,
       coalesce(p.internet_out,            c.internet_out,            'full')  AS internet_out,
       coalesce(p.inbound_from_wan,        c.inbound_from_wan,        false)   AS inbound_from_wan,
       coalesce(p.talk_to_iot,             c.talk_to_iot,             false)   AS talk_to_iot,
       coalesce(p.talk_to_personal,        c.talk_to_personal,        false)   AS talk_to_personal,
       coalesce(p.reachable_from_personal, c.reachable_from_personal, true)    AS reachable_from_personal,
       coalesce(vp.vendor, va.vendor)         AS cloud,
       (coalesce(vp.vendor, va.vendor) IS NOT NULL) AS vendor_known,
       (p.device_id IS NOT NULL)              AS overridden,
       (c.kind IS NOT NULL)                   AS class_known
FROM devices d
LEFT JOIN device_policy       p  ON p.device_id = d.id
LEFT JOIN device_class_policy c  ON c.kind = d.kind
LEFT JOIN vendor_clouds       vp ON vp.id = p.vendor_id
LEFT JOIN vendor_aliases      a  ON lower(a.alias) = lower(d.vendor)
LEFT JOIN vendor_clouds       va ON va.id = a.vendor_id
WHERE d.category = 'iot' AND d.is_active AND d.reserved_ip IS NOT NULL;

-- Grants as address pairs, which is the shape the firewall wants.
DROP VIEW IF EXISTS device_access_pairs;
CREATE VIEW device_access_pairs AS
SELECT host(s.reserved_ip) AS src_ip, host(t.reserved_ip) AS dst_ip,
       coalesce(s.label, s.hostname, 'device '||s.id) AS src_name,
       coalesce(t.label, t.hostname, 'device '||t.id) AS dst_name,
       g.note
FROM device_access_grants g
JOIN devices s ON s.id = g.src_device_id
JOIN devices t ON t.id = g.dst_device_id
WHERE s.reserved_ip IS NOT NULL AND t.reserved_ip IS NOT NULL
  AND s.is_active AND t.is_active;

-- ---------------------------------------------------------------------------
-- Shipped defaults per class.
-- ---------------------------------------------------------------------------
-- The shape to read: cameras, doorbells and locks are locked down hard OUTWARD
-- (vendor cloud only) and shut INWARD (nothing from the internet, nothing from
-- another gadget), but they stay reachable from the household's own phones,
-- because that is the whole point of owning them.
--
-- Speakers get the ordinary internet. An Echo or a Sonos talks to music
-- services, skill endpoints and a dozen CDNs, and pinning it to a domain list
-- produces a broken speaker and an unhappy house. It is also the device with
-- the least to steal: no video of your front door.
INSERT INTO device_class_policy
  (kind, label, internet_out, inbound_from_wan, talk_to_iot, talk_to_personal, reachable_from_personal, note) VALUES
 ('camera','Security camera','vendor',false,false,false,true,
  'Cloud recording keeps working (that is the theft backup). Nothing may reach it from the internet, and it may not roam the house.'),
 ('doorbell','Video doorbell','vendor',false,false,false,true,
  'Same as a camera. It must reach its cloud to send you the alert.'),
 ('lock','Smart lock','vendor',false,false,false,true,
  'Vendor cloud only, so remote unlock keeps working. Nothing else may start a conversation with it.'),
 ('vacuum','Robot vacuum','vendor',false,false,false,true,
  'Vendor only. A vacuum holds a floor plan of your house and has no reason to talk to anything else.'),
 ('speaker','Smart speaker','full',false,false,false,true,
  'General internet: music, skills and CDNs are too broad to pin down. Still cannot reach your phones or the other gadgets.'),
 ('light','Smart light','vendor',false,false,false,true,null),
 ('plug','Smart plug','vendor',false,false,false,true,null),
 ('thermostat','Thermostat','vendor',false,false,false,true,null),
 ('appliance','Connected appliance','vendor',false,false,false,true,
  'A fridge that talks to one vendor is fine. A fridge that talks to anything is a botnet member.'),
 ('printer','Printer','none',false,false,false,true,
  'Printers are printed to, not from. No internet at all by default; turn it on if you use cloud print.'),
 ('nvr','Camera recorder (NVR)','vendor',false,true,false,true,
  'The one class allowed to talk to other IoT devices, because pulling the camera streams is its job.'),
 ('iot-generic','Generic smart device','vendor',false,false,false,true,
  'Anything the classifier could only tell was a gadget. Vendor-only if we know the vendor, otherwise left alone and reported.')
ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Vendor clouds and their domains.
-- ---------------------------------------------------------------------------
INSERT INTO vendor_clouds (vendor, label, common, note) VALUES
 ('_common','Time and certificate infrastructure',true,
  'Allowed for every vendor-restricted device. A gadget with the wrong clock cannot validate a certificate, and then it cannot reach its own vendor either.'),
 ('Amazon','Amazon (Echo, Alexa)',false,null),
 ('Ring','Ring',false,null),
 ('Google-Nest','Google Nest',false,null),
 ('WyzeLabs','Wyze',false,null),
 ('Reolink','Reolink',false,null),
 ('Arlo','Arlo',false,null),
 ('Eufy','Eufy / Anker',false,null),
 ('Hikvision','Hikvision / EZVIZ',false,null),
 ('Dahua','Dahua / Imou',false,null),
 ('Ubiquiti','Ubiquiti UniFi Protect',false,null),
 ('TP-Link','TP-Link / Tapo / Kasa',false,null),
 ('August','August / Yale',false,null),
 ('Schlage','Schlage / Allegion',false,null),
 ('Lockly','Lockly',false,null),
 ('iRobot','iRobot Roomba',false,null),
 ('Ecovacs','Ecovacs',false,null),
 ('Roborock','Roborock',false,null),
 ('Sonos','Sonos',false,null),
 ('Philips-Hue','Philips Hue',false,null),
 ('Tuya','Tuya / Smart Life',false,'The white-label cloud behind a great many cheap gadgets.'),
 ('Shelly','Shelly',false,null),
 ('Ecobee','Ecobee',false,null),
 ('Sensibo','Sensibo',false,null)
ON CONFLICT (vendor) DO NOTHING;

INSERT INTO vendor_domains (vendor_id, domain)
SELECT v.id, x.domain FROM (VALUES
 -- Time and certificate checking. Deliberately small: NTP and OCSP, nothing else.
 ('_common','pool.ntp.org'),('_common','time.google.com'),('_common','time.cloudflare.com'),
 ('_common','time.apple.com'),('_common','time.windows.com'),('_common','time.nist.gov'),
 ('_common','ocsp.digicert.com'),('_common','ocsp.pki.goog'),('_common','r3.o.lencr.org'),
 ('Amazon','amazon.com'),('Amazon','amazonalexa.com'),('Amazon','alexa.amazon.com'),
 ('Amazon','media-amazon.com'),('Amazon','amazontrust.com'),('Amazon','a2z.com'),
 ('Ring','ring.com'),('Ring','a2z.com'),('Ring','amazontrust.com'),
 ('Google-Nest','nest.com'),('Google-Nest','home.nest.com'),('Google-Nest','googleapis.com'),
 ('Google-Nest','gstatic.com'),
 ('WyzeLabs','wyze.com'),('WyzeLabs','wyzecam.com'),
 ('Reolink','reolink.com'),('Reolink','reolink.us'),('Reolink','reolinkcdn.com'),
 ('Arlo','arlo.com'),('Arlo','netgear.com'),
 ('Eufy','eufylife.com'),('Eufy','eufy.com'),('Eufy','anker.com'),
 ('Hikvision','hikvision.com'),('Hikvision','hik-connect.com'),('Hikvision','ezvizlife.com'),
 ('Dahua','dahuasecurity.com'),('Dahua','easy4ip.com'),('Dahua','imoulife.com'),
 ('Ubiquiti','ui.com'),('Ubiquiti','ubnt.com'),
 ('TP-Link','tplinkcloud.com'),('TP-Link','tplinkra.com'),('TP-Link','tplinknbu.com'),
 ('TP-Link','tplinkcloud.com.cn'),('TP-Link','tp-link.com'),
 ('August','august.com'),('August','yalehome.com'),('August','yaleaccess.com'),
 ('Schlage','allegion.com'),('Schlage','schlage.com'),
 ('Lockly','lockly.com'),
 ('iRobot','irobot.com'),('iRobot','irobotapi.com'),('iRobot','irobotweb.com'),
 ('Ecovacs','ecovacs.com'),('Ecovacs','ecouser.net'),
 ('Roborock','roborock.com'),
 ('Sonos','sonos.com'),('Sonos','sonos.radio'),
 ('Philips-Hue','meethue.com'),('Philips-Hue','philips-hue.com'),('Philips-Hue','philips.com'),
 ('Tuya','tuya.com'),('Tuya','tuyaeu.com'),('Tuya','tuyaus.com'),('Tuya','tuyacn.com'),
 ('Shelly','shelly.cloud'),('Shelly','allterco.com'),
 ('Ecobee','ecobee.com'),
 ('Sensibo','sensibo.com')
) AS x(vname, domain) JOIN vendor_clouds v ON v.vendor = x.vname
ON CONFLICT DO NOTHING;

-- What kidnet-classify actually writes in devices.vendor, mapped onto a cloud.
INSERT INTO vendor_aliases (alias, vendor_id)
SELECT x.alias, v.id FROM (VALUES
 ('amazon','Amazon'),('ring','Ring'),('google-nest','Google-Nest'),('nest','Google-Nest'),
 ('wyzelabs','WyzeLabs'),('wyze','WyzeLabs'),('reolink','Reolink'),('arlo','Arlo'),
 ('eufy','Eufy'),('anker','Eufy'),('hikvision','Hikvision'),('ezviz','Hikvision'),
 ('dahua','Dahua'),('imou','Dahua'),('ubiquiti','Ubiquiti'),('unifi','Ubiquiti'),
 ('tp-link','TP-Link'),('tplink','TP-Link'),('tapo','TP-Link'),('kasa','TP-Link'),
 ('august','August'),('yale','August'),('schlage','Schlage'),('lockly','Lockly'),
 ('irobot','iRobot'),('roomba','iRobot'),('ecovacs','Ecovacs'),('roborock','Roborock'),
 ('sonos','Sonos'),('philips-hue','Philips-Hue'),('hue','Philips-Hue'),
 ('tuya','Tuya'),('shelly','Shelly'),('ecobee','Ecobee'),('sensibo','Sensibo')
) AS x(alias, vname) JOIN vendor_clouds v ON v.vendor = x.vname
ON CONFLICT (alias) DO NOTHING;

-- The dashboard reads policy to show it. It never writes it: the only audited
-- path to the firewall is bin/kidnet and bin/kidnet-iot-policy.
GRANT SELECT ON vendor_clouds, vendor_domains, vendor_ips, vendor_aliases,
                device_class_policy, device_policy, device_access_grants,
                iot_policy_settings, device_policy_effective, device_access_pairs
      TO kids_app;
