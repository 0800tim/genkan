-- Gamification: badges a child earns, the log of study-page visits that
-- some badges and the board read, and the household switch for the board.
-- See docs/GAMIFICATION.md for the reasoning, including what was rejected.
--
-- The short version of that reasoning: a raw leaderboard (total minutes,
-- total passes) tells the youngest child in the house that they are losing,
-- every single day, which is the opposite of what this project is for. So
-- badges here are personal milestones, never a race against a sibling, and
-- the one comparison view Hearth ships (dashboard/badges.mjs: boardData)
-- deals only in things that do not simply favour whoever is oldest: how much
-- somebody has improved lately, how many different things they have tried,
-- how often they have bounced back from a flop, how much they read up. It is
-- off by default, the same call schema-claim.sql made for the same reason: a
-- household should not wake up with a new social feature it never asked for.
--
-- Load order: after schema.sql (children must exist). Nothing here is
-- required for anything else to work: dashboard/badges.mjs treats every
-- write and read here as best effort, so a gateway that has not loaded this
-- file still runs quizzes and still pays out minutes, it just does not
-- award badges or show a board. Idempotent, safe to re-run.

-- One row per badge a child has earned. `scope` is '' for a badge that can
-- only ever be earned once (first pass, first perfect round, ten passes),
-- and a quiz bank's id for a badge that can be earned again for a different
-- bank (a bank mastered, a bank studied then passed, a bank tried for the
-- first time). The unique index is what makes awarding idempotent: the
-- award code always INSERTs with ON CONFLICT DO NOTHING, so checking a
-- round twice, or a slow request retried, can never double up a badge or
-- hand out a second row to gloat over.
CREATE TABLE IF NOT EXISTS child_badges (
  id       bigserial PRIMARY KEY,
  child_id int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  badge_id text NOT NULL,             -- matches an id in dashboard/badges.mjs's BADGES list
  scope    text NOT NULL DEFAULT '',  -- '' = once ever; otherwise a bank id
  ts       timestamptz NOT NULL DEFAULT now(),
  meta     jsonb NOT NULL DEFAULT '{}'::jsonb   -- small display extras, e.g. {"bank_title":"..."}
);
CREATE UNIQUE INDEX IF NOT EXISTS child_badges_once_idx ON child_badges (child_id, badge_id, scope);
CREATE INDEX IF NOT EXISTS child_badges_child_idx ON child_badges (child_id, ts DESC);

-- Every time a child opens a bank's "read up" page. Append-only on purpose:
-- it is what tells the "read the study page then passed it" badge whether
-- they actually stopped to read first, and it is also the household board's
-- "keenest reader" number, which wants a genuine count of visits rather than
-- just the most recent one.
CREATE TABLE IF NOT EXISTS quiz_study_visits (
  id       bigserial PRIMARY KEY,
  child_id int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  bank_id  text NOT NULL,
  ts       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_study_visits_child_idx ON quiz_study_visits (child_id, bank_id, ts DESC);

-- One row, the household's switch for the comparison board. Badges a child
-- earns are always visible to that child alone, whatever this says; this
-- only controls whether siblings can see any comparison of each other at
-- all. Off by default: see the note at the top of this file.
CREATE TABLE IF NOT EXISTS board_settings (
  only_row   boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  enabled    boolean NOT NULL DEFAULT false,
  updated_ts timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO board_settings (only_row) VALUES (true) ON CONFLICT DO NOTHING;

-- The portal and dashboard connect as the limited kids_app role.
GRANT SELECT, INSERT ON child_badges TO kids_app;
GRANT SELECT, INSERT ON quiz_study_visits TO kids_app;
GRANT SELECT, UPDATE ON board_settings TO kids_app;
GRANT USAGE ON SEQUENCE child_badges_id_seq, quiz_study_visits_id_seq TO kids_app;
