-- Learn to earn: who is offered which job, and which quizzes count for whom.
--
-- The tables in schema-time.sql and schema-earn.sql already carry the loop
-- itself: `tasks` is the list of jobs, `earn_claims` is "I did this, please
-- check", `time_events` is the audit trail every earned minute lands in. What
-- was missing is the part a parent actually asks for first, which is that the
-- offer is not the same for every child. A 16 year old can run the weed eater
-- for an hour of time. An 11 year old cannot, and should be offered a shower
-- and the dishes instead.
--
-- Two small ideas, and nothing else:
--
--   task_offers    per child, per job: offer it or do not, and pay what this
--                  child is paid for it. NULL minutes means "the usual".
--   quiz_settings  per child, per quiz bank: show it or do not, and what a
--                  pass is worth. NULL minutes means "whatever the bank's
--                  JSON says".
--
-- Both are OVERRIDE tables. A child with no row keeps the default, so
-- installing this file changes nothing for a household that is already
-- running, and a parent who never opens the new screen never notices it.
--
-- Nothing here enforces anything or touches the firewall. The worst a bad row
-- can do is offer a job to the wrong child, or offer one nobody wants.

-- ---------------------------------------------------------------------------
-- tasks: two columns the UI needed, both with a default that preserves
-- today's behaviour exactly.
-- ---------------------------------------------------------------------------
-- everyone = true  the job is on every child's list, unless a task_offers row
--                  for that child switches it off (the seeded chores, and the
--                  natural way to write "dishes").
-- everyone = false the job is on nobody's list except the children with an
--                  active task_offers row ("the weeding, eldest only").
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS everyone boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN tasks.everyone IS
  'true = offered to every child unless a task_offers row opts them out; false = offered only to children with an active task_offers row';

-- One emoji for the job's card on the portal. NULL falls back to the basket.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS emoji text;

-- Who wrote it down, and when. Useful in the history, harmless everywhere.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_ts timestamptz NOT NULL DEFAULT now();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS set_by text;

-- ---------------------------------------------------------------------------
-- Per-child offers.
-- ---------------------------------------------------------------------------
-- active  false = "not this child", whatever tasks.everyone says
--         true  = "yes this child", whatever tasks.everyone says
-- minutes NULL  = pay the usual tasks.minutes; a number = pay this child that
--         instead. An hour of weeding is worth more from the 16 year old than
--         a shower is worth from the 11 year old, and both are fair.
CREATE TABLE IF NOT EXISTS task_offers (
  task_id    int  NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  child_id   int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  active     boolean NOT NULL DEFAULT true,
  minutes    int,
  set_by     text,
  updated_ts timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, child_id)
);

-- ---------------------------------------------------------------------------
-- Per-child quiz bank settings.
-- ---------------------------------------------------------------------------
-- bank_id is the `id` in portal/quizzes/<id>.json, the same string that ends
-- up in time_events.reason as 'quiz:<id>'. It cannot be a foreign key because
-- the banks are files, not rows: that is deliberate, a bank arrives by pull
-- request and needs no migration. A row for a bank that has since been
-- removed is inert, so nothing has to clean up after a deleted file.
CREATE TABLE IF NOT EXISTS quiz_settings (
  child_id   int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  bank_id    text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  minutes    int,                      -- NULL = the bank's own minutes_per_pass
  set_by     text,
  updated_ts timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, bank_id)
);

-- Guard the numbers in the database as well as in the app, so a stray write
-- cannot leave a job worth eight hours or a quiz worth nothing. Added
-- separately and guarded, because ALTER TABLE ADD CONSTRAINT has no
-- IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_offers_minutes_ck') THEN
    ALTER TABLE task_offers ADD CONSTRAINT task_offers_minutes_ck
      CHECK (minutes IS NULL OR (minutes >= 1 AND minutes <= 480));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_settings_minutes_ck') THEN
    ALTER TABLE quiz_settings ADD CONSTRAINT quiz_settings_minutes_ck
      CHECK (minutes IS NULL OR (minutes >= 1 AND minutes <= 120));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_settings_bank_ck') THEN
    ALTER TABLE quiz_settings ADD CONSTRAINT quiz_settings_bank_ck
      CHECK (bank_id ~ '^[a-z0-9-]{1,48}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS task_offers_child_idx ON task_offers (child_id);

-- ---------------------------------------------------------------------------
-- The one thing the portal reads: what is on THIS child's list right now,
-- and what it pays THEM.
-- ---------------------------------------------------------------------------
-- One row per job per person, `offered` already worked out, so the portal and
-- the dashboard can never drift apart on the rule. A parent configures it on
-- /earn and the child sees exactly that, because both read this view.
DROP VIEW IF EXISTS task_offer_effective;
CREATE VIEW task_offer_effective AS
SELECT t.id                         AS task_id,
       c.id                         AS child_id,
       c.name                       AS child,
       t.name,
       t.emoji,
       COALESCE(o.minutes, t.minutes) AS minutes,
       t.minutes                    AS default_minutes,
       (o.minutes IS NOT NULL)      AS custom_minutes,
       t.needs_approval,
       t.active                     AS task_active,
       t.everyone,
       (o.task_id IS NOT NULL)      AS has_row,
       (t.active AND CASE WHEN t.everyone THEN COALESCE(o.active, true)
                                          ELSE COALESCE(o.active, false) END) AS offered
FROM tasks t
CROSS JOIN children c
LEFT JOIN task_offers o ON o.task_id = t.id AND o.child_id = c.id;

-- The dashboard writes these as the limited kids_app role, the same way it
-- decides a chore claim or sets a goal. The portal only reads them.
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks, task_offers, quiz_settings TO kids_app;
GRANT USAGE ON SEQUENCE tasks_id_seq TO kids_app;
GRANT SELECT ON task_offer_effective TO kids_app;
