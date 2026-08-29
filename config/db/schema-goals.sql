-- Weekly goals per child: the one number a parent and a kid agreed on.
--
-- A goal is deliberately small. One line, one metric, one week: "no more than
-- six hours of video", "earn at least an hour through learning". It is a
-- shared target to talk about on a Sunday, NOT an enforcement mechanism: the
-- meter and category_budgets do the enforcing, and nothing in this table ever
-- blocks anything. Missing a goal produces a conversation, not a punishment.
--
-- Everything is measured in MINUTES over a Monday-to-Sunday week, so the goal
-- lines up with bin/kidnet-report and the /week digest. Metrics come straight
-- from figures the dashboard already shows, so a goal can never quietly mean
-- something different from the chart above it:
--
--   online   time_ledger.used_min          all metered time online
--   metered  category_usage, all metered   gaming + video + social
--   gaming   category_usage 'gaming'       the meter's gaming minutes
--   video    category_usage 'video'        the meter's video minutes
--   social   category_usage 'social'       the meter's social minutes
--   earned   time_events kind='earn'       quizzes plus approved chores
--   quiz     time_events reason 'quiz:%'   quiz minutes only
--   chore    time_events reason 'task:%'   approved chore minutes only
--
-- Parent bonuses (kind='grant') are never a goal metric: a gift is not
-- something a child earned, and a goal you can be handed is not a goal.
CREATE TABLE IF NOT EXISTS goals (
  id         serial PRIMARY KEY,
  child_id   int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  metric     text NOT NULL,
  direction  text NOT NULL DEFAULT 'at_most',   -- at_most | at_least
  target_min int NOT NULL,                      -- minutes per week
  active     boolean NOT NULL DEFAULT true,
  note       text,
  set_by     text,
  created_ts timestamptz NOT NULL DEFAULT now(),
  updated_ts timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_id, metric)
);

-- Guard the vocabulary in the database, not only in the app, so a stray write
-- cannot leave a goal that no view knows how to measure. Added separately and
-- guarded, because ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_metric_ck') THEN
    ALTER TABLE goals ADD CONSTRAINT goals_metric_ck
      CHECK (metric IN ('online','metered','gaming','video','social','earned','quiz','chore'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_direction_ck') THEN
    ALTER TABLE goals ADD CONSTRAINT goals_direction_ck
      CHECK (direction IN ('at_most','at_least'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_target_ck') THEN
    ALTER TABLE goals ADD CONSTRAINT goals_target_ck
      CHECK (target_min > 0 AND target_min <= 10080);   -- a week has 10080 minutes
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS goals_child_idx ON goals (child_id) WHERE active;

-- The dashboard sets and clears goals as the limited kids_app role, the same
-- way it decides a chore claim. It is the only writer.
GRANT SELECT, INSERT, UPDATE, DELETE ON goals TO kids_app;
GRANT USAGE ON SEQUENCE goals_id_seq TO kids_app;

-- Acknowledging an alert ("we talked about it") is the dashboard's other write
-- against a table it does not own, so the grant belongs with the schema rather
-- than with a hand-run command on one box.
GRANT SELECT, UPDATE ON alerts TO kids_app;
