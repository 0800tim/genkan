-- Quiz results: what actually happened in a round, so the next round can be
-- built for the kid in front of it rather than for a generic kid.
--
-- Until now the only trace a quiz left was a time_events row (kind='earn',
-- reason='quiz:<bank>'), which is a record of PASSES. That is enough to pay a
-- kid and to enforce the cooldown, and it is deliberately kept as the money
-- trail. What it cannot tell you is:
--
--   * how a round went when it did not pass (no row is written at all), and
--   * which questions were the ones that hurt.
--
-- The difficulty ramp needs both. A kid who has just scraped 5/10 should get
-- an easier, more encouraging round next time; a kid passing 10/10 should be
-- stretched. So every graded round lands here, pass or fail, with one row per
-- question answered and the difficulty that question carried.
--
-- This table is a TEACHING aid, not a report card. Nothing in here blocks
-- anything, docks anything, or is shown to a kid as a score history. It exists
-- so the quiz can meet them where they are.
--
-- Load order: after schema-time.sql (children must exist). Idempotent; safe to
-- re-run. The portal treats every write here as best-effort: if this file has
-- not been loaded, quizzes still work and kids still earn, they just get the
-- flat random round instead of the ramp.

-- One row per graded round.
CREATE TABLE IF NOT EXISTS quiz_rounds (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  child_id   int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  bank_id    text NOT NULL,               -- matches the bank's "id", as in time_events.reason
  asked      int  NOT NULL,
  correct    int  NOT NULL,
  passed     boolean NOT NULL,
  minutes    int  NOT NULL DEFAULT 0,     -- credited for this round (0 on a fail, cooldown or cap)
  profile    text,                        -- building | steady | confident: the mix this round was built with
  avg_difficulty numeric(4,2)             -- NULL when the bank carries no difficulty data
);
CREATE INDEX IF NOT EXISTS quiz_rounds_child_idx ON quiz_rounds (child_id, ts DESC);
CREATE INDEX IF NOT EXISTS quiz_rounds_bank_idx  ON quiz_rounds (child_id, bank_id, ts DESC);

-- One row per question answered. seq is the position in the round, so the
-- ramp itself can be read back and checked.
CREATE TABLE IF NOT EXISTS quiz_answers (
  round_id    bigint NOT NULL REFERENCES quiz_rounds(id) ON DELETE CASCADE,
  seq         int  NOT NULL,
  question_id text NOT NULL,
  difficulty  int,                        -- 1..5, NULL when the question carries none
  correct     boolean NOT NULL,
  PRIMARY KEY (round_id, seq),
  CONSTRAINT quiz_answers_difficulty_ck CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5)
);
CREATE INDEX IF NOT EXISTS quiz_answers_question_idx ON quiz_answers (question_id);

-- Recent form per child per bank. "Recent" is 30 days: long enough to have
-- something to go on, short enough that a rough patch in July does not still
-- be holding a kid back in September.
CREATE OR REPLACE VIEW quiz_form AS
SELECT r.child_id,
       r.bank_id,
       count(*)                                   AS rounds,
       count(*) FILTER (WHERE r.passed)           AS passes,
       sum(r.asked)                               AS asked,
       sum(r.correct)                             AS correct,
       round(sum(r.correct)::numeric / NULLIF(sum(r.asked), 0), 3) AS accuracy,
       max(r.ts)                                  AS last_ts
FROM quiz_rounds r
WHERE r.ts > now() - interval '30 days'
GROUP BY r.child_id, r.bank_id;

-- How a child goes at each difficulty level, across all banks. This is the
-- honest answer to "what can this kid already do", and it is what stops the
-- ramp from either babying them or drowning them.
CREATE OR REPLACE VIEW quiz_difficulty_form AS
SELECT r.child_id,
       a.difficulty,
       count(*)                          AS asked,
       count(*) FILTER (WHERE a.correct) AS correct,
       round(count(*) FILTER (WHERE a.correct)::numeric / count(*), 3) AS accuracy
FROM quiz_answers a
JOIN quiz_rounds r ON r.id = a.round_id
WHERE a.difficulty IS NOT NULL
  AND r.ts > now() - interval '30 days'
GROUP BY r.child_id, a.difficulty;

-- The portal and dashboard connect as the limited kids_app role.
GRANT SELECT, INSERT ON quiz_rounds  TO kids_app;
GRANT SELECT, INSERT ON quiz_answers TO kids_app;
GRANT USAGE ON SEQUENCE quiz_rounds_id_seq TO kids_app;
GRANT SELECT ON quiz_form, quiz_difficulty_form TO kids_app;
