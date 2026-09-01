-- The Settings page: the filter levels as data, and the allow list a parent
-- can grow but not narrow.
--
-- Load order: after seed.sql and schema-roles.sql (both insert policies rows
-- and this file fills columns on them), and after schema-safety.sql and the
-- two schema-learn files (this file adds columns to always_allow and a
-- trigger over it). It is pure additions: every statement is idempotent, and
-- a household that reloads it keeps every edit it has made.
--
-- WHY THE FILTER LEVELS MOVED INTO THE DATABASE
-- What "young" meant on the DNS side lived in a Python dict inside
-- bin/genkan-adguard-clients: parental control on, SafeSearch on, a list of
-- blocked services. A parent who wanted TikTok blocked for the middle child
-- but not the eldest had to edit a script in a public repo, or tune the
-- AdGuard client by hand and hope nothing rebuilt it. The policies table
-- already carried the level's name, description and daily minutes, so the
-- rest of the level now sits beside them, and the dashboard's Settings page
-- edits it through `genkan tier set`. The script keeps the old dict as a
-- fallback for a box whose database has not loaded this file yet, and the
-- values below ARE that dict, so loading this changes nobody's filter.
--
-- The columns are filled per level only where they are NULL, so re-running
-- the file cannot undo a parent's edit. A level added later gets the column
-- defaults, which are the 'standard' answers.

ALTER TABLE policies ADD COLUMN IF NOT EXISTS adguard_parental boolean;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS adguard_services text[];
ALTER TABLE policies ADD COLUMN IF NOT EXISTS adguard_private  boolean;

-- Today's TEMPLATES, one row per shipped level. 'adult' has no AdGuard
-- client of its own (a household adult is unrestricted, which is what the
-- catch-all client already gives them), so its row records "nothing" and
-- genkan-adguard-clients never reads it.
--
-- The safesearch column existed before this file but nothing enforced it,
-- and on at least one box it disagreed with the script's table for the guest
-- level (the column said on, the script said off, and off is what visitors
-- actually had). Now that the column is enforced it is set to what was
-- enforced, once, in the same moment the new columns are filled: the
-- adguard_parental IS NULL guard means this cannot run a second time and
-- undo a parent's later edit.
UPDATE policies SET safesearch = CASE tier
    WHEN 'young' THEN true WHEN 'standard' THEN true WHEN 'teen' THEN false
    WHEN 'guest' THEN false WHEN 'adult' THEN false ELSE safesearch END
  WHERE adguard_parental IS NULL;
UPDATE policies SET adguard_parental = CASE tier
    WHEN 'young' THEN true WHEN 'standard' THEN true WHEN 'teen' THEN false
    WHEN 'guest' THEN true WHEN 'adult' THEN false ELSE true END
  WHERE adguard_parental IS NULL;
UPDATE policies SET adguard_services = CASE tier
    WHEN 'young'    THEN ARRAY['4chan','9gag','tiktok','instagram','snapchat','twitter','reddit',
                               'twitch','discord','onlyfans','tinder','grindr']
    WHEN 'standard' THEN ARRAY['4chan','onlyfans','tinder','grindr']
    WHEN 'teen'     THEN ARRAY['onlyfans','tinder','grindr']
    ELSE ARRAY[]::text[] END
  WHERE adguard_services IS NULL;
UPDATE policies SET adguard_private = (tier = 'guest') WHERE adguard_private IS NULL;

ALTER TABLE policies ALTER COLUMN adguard_parental SET DEFAULT true;
ALTER TABLE policies ALTER COLUMN adguard_services SET DEFAULT ARRAY['4chan','onlyfans','tinder','grindr']::text[];
ALTER TABLE policies ALTER COLUMN adguard_private  SET DEFAULT false;
ALTER TABLE policies ALTER COLUMN adguard_parental SET NOT NULL;
ALTER TABLE policies ALTER COLUMN adguard_services SET NOT NULL;
ALTER TABLE policies ALTER COLUMN adguard_private  SET NOT NULL;

COMMENT ON COLUMN policies.adguard_parental IS
  'AdGuard''s parental control (its adult-content category) for every client on this level. safesearch is the column beside it.';
COMMENT ON COLUMN policies.adguard_services IS
  'AdGuard blocked-service ids (see /control/blocked_services/all) for every client on this level. Empty means none.';
COMMENT ON COLUMN policies.adguard_private IS
  'true keeps this level''s clients out of AdGuard''s per-client query log and statistics. The guest level''s promise.';
COMMENT ON COLUMN policies.safesearch IS
  'SafeSearch forced on Google, Bing, DuckDuckGo, YouTube and the rest, for every client on this level.';

-- ---------------------------------------------------------------------------
-- The allow list a parent can grow but not narrow
-- ---------------------------------------------------------------------------
-- always_allow has three promises a Settings page can show (schema-safety.sql
-- and schema-learn.sql): 'safety' survives everything and must never be
-- narrowed, 'learn' is the reading list and is a household's to choose, and
-- the category='search' rows are exact hosts, allowed by name and not by
-- suffix (DECISIONS.md, "Allowed by address, filtered by name").
--
-- A parent adds rows through `genkan allow add`, which stamps who added it and
-- when. Shipped rows carry NULL here. The distinction matters for removal: a
-- shipped row deleted by hand comes straight back the next time the schema is
-- reloaded (every seed is ON CONFLICT DO NOTHING), so the page only offers to
-- remove what a parent added, and says so.
ALTER TABLE always_allow ADD COLUMN IF NOT EXISTS added_by text;
ALTER TABLE always_allow ADD COLUMN IF NOT EXISTS added_ts timestamptz;
COMMENT ON COLUMN always_allow.added_by IS
  'NULL for a row the schema shipped. ''parent'' for a row added through genkan allow add, which is the only kind the Settings page will remove.';

-- The safety net cannot be narrowed, and the database is where that promise
-- is kept, not the CLI or the page. kids_agent is granted DELETE on this
-- table so a parent can take a reading-list row back out; this trigger is
-- what keeps that grant from ever reaching a help line. It refuses the
-- superuser too, on purpose: a runbook that wants a safety row gone has to
-- say so by dropping the trigger first, in writing.
CREATE OR REPLACE FUNCTION always_allow_keep_safety() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.scope = 'safety' THEN
      RAISE EXCEPTION 'always_allow: % is part of the safety net and cannot be removed', OLD.domain
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  -- An UPDATE that moves a safety row to a weaker scope is a removal wearing
  -- a different verb. Moving a row INTO safety is fine: that is what
  -- schema-safety.sql does when it runs.
  IF OLD.scope = 'safety' AND NEW.scope IS DISTINCT FROM 'safety' THEN
    RAISE EXCEPTION 'always_allow: % is part of the safety net and its scope cannot be narrowed', OLD.domain
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS always_allow_keep_safety ON always_allow;
CREATE TRIGGER always_allow_keep_safety
  BEFORE DELETE OR UPDATE ON always_allow
  FOR EACH ROW EXECUTE FUNCTION always_allow_keep_safety();

-- The Google search hosts, exactly as the 2026-09-02 decision added them by
-- hand on the first box. Exact hosts, matched by an anchored rule so
-- google.com does not bring mail.google.com with it, and not
-- accounts.google.com, which is where a sign-in would start. scope='learn' so
-- they survive a cut the way the reading list does. Shipped here so a fresh
-- install can search while cut, rather than only the box they were typed on.
INSERT INTO always_allow (domain, scope, category, note) VALUES
  ('google.com',                  'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('www.google.com',              'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('google.co.nz',                'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('www.google.co.nz',            'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('forcesafesearch.google.com',  'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('apis.google.com',             'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('www.gstatic.com',             'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('ssl.gstatic.com',             'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('fonts.gstatic.com',           'learn', 'search', 'Google search (exact host, not Gmail or messaging)'),
  ('encrypted-tbn0.gstatic.com',  'learn', 'search', 'Google search (exact host, not Gmail or messaging)')
ON CONFLICT (domain) DO NOTHING;

-- The dashboard reads all of this to show it. It writes none of it: every
-- change goes through bin/genkan as kids_agent (config/db/grants.sql).
GRANT SELECT ON policies, always_allow TO kids_app;
