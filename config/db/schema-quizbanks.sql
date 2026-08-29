-- Quiz banks a parent wrote, and the numbers that tune what earning is worth.
--
-- Two separate jobs live in this file because they arrived together, from the
-- same complaint: the learn-to-earn half of Hearth could only be changed by
-- editing files in the repo, which is fine for an agent and useless for a
-- parent on the couch with a phone.
--
--   quiz_banks / quiz_bank_questions
--       Banks written in the dashboard. They live HERE, in the database, and
--       never in portal/quizzes/. That directory is tracked in git, so a
--       `git pull` would happily delete a family's own content. The portal
--       merges the two sources when it loads: file banks first, then these.
--
--   earn_settings
--       The numbers that used to be constants in dashboard/portal.mjs: the
--       cooldown per bank, the daily cap on quiz minutes, the perfect-round
--       bonus, and what a pass is worth when nothing else says. One row with
--       child_id NULL is the household default; a row with a child_id
--       overrides it for that child. Read through earn_settings_effective,
--       which falls back to the old constants, so a household that never
--       opens the screen sees exactly the behaviour it had before.
--
-- Load order: after schema.sql (children) and after schema-tasks.sql, which
-- creates quiz_settings, the per child on/off and price for a bank. Nothing
-- here enforces anything or touches the firewall. Idempotent, safe to re-run.
--
-- Honest limit, stated once here and again in the dashboard: a bank written
-- in the dashboard goes live to the kids as soon as it holds one full round
-- of questions, where a bank shipped as a file still needs four rounds' worth
-- (tools/validate-quizzes.mjs enforces that on files, and nothing here changes
-- it). A small bank repeats itself. The dashboard says so on the bank's own
-- card rather than blocking a parent who has written twelve good questions.

-- ---------------------------------------------------------------------------
-- The banks themselves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_banks (
  id                  text PRIMARY KEY,           -- slug, same shape as a file bank's id
  title               text NOT NULL,
  emoji               text,
  suggested_age_min   int,
  minutes_per_pass    int  NOT NULL DEFAULT 10,
  pass_mark           int  NOT NULL DEFAULT 8,
  questions_per_round int  NOT NULL DEFAULT 10,
  source_note         text,                       -- where the content came from, and when it was checked
  active              boolean NOT NULL DEFAULT true,  -- false = a draft, invisible to the kids
  created_by          text,
  created_ts          timestamptz NOT NULL DEFAULT now(),
  updated_ts          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_banks_id_ck    CHECK (id ~ '^[a-z0-9-]{1,48}$'),
  CONSTRAINT quiz_banks_title_ck CHECK (length(title) BETWEEN 1 AND 60),
  CONSTRAINT quiz_banks_nums_ck  CHECK (minutes_per_pass BETWEEN 1 AND 120
                                    AND pass_mark BETWEEN 1 AND 50
                                    AND questions_per_round BETWEEN 3 AND 50
                                    AND pass_mark <= questions_per_round)
);

-- One row per question. The shape is portal/quizzes/FORMAT.md, held as
-- columns rather than JSON so the constraints below can be real constraints.
-- choices is jsonb only because "exactly four strings" is a list, not a set of
-- columns, and a check constraint can still police it.
CREATE TABLE IF NOT EXISTS quiz_bank_questions (
  bank_id      text NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  question_id  text NOT NULL,                     -- unique within the bank, stable, logged in quiz_answers
  seq          int  NOT NULL DEFAULT 0,           -- author's order; the portal reorders every round anyway
  prompt       text NOT NULL,
  choices      jsonb NOT NULL,
  answer_index int  NOT NULL,
  difficulty   int,                               -- 1 warm-up .. 5 stretch, NULL for an unlabelled bank
  explanation  text,                              -- the sentence a child reads after answering
  updated_ts   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bank_id, question_id),
  CONSTRAINT quiz_bank_questions_qid_ck    CHECK (question_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  CONSTRAINT quiz_bank_questions_prompt_ck CHECK (length(btrim(prompt)) BETWEEN 1 AND 400),
  CONSTRAINT quiz_bank_questions_ans_ck    CHECK (answer_index BETWEEN 0 AND 3),
  CONSTRAINT quiz_bank_questions_diff_ck   CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  CONSTRAINT quiz_bank_questions_expl_ck   CHECK (explanation IS NULL OR length(explanation) <= 400),
  -- Exactly four choices, every one a non-empty string. The portal shuffles
  -- them per round and remaps answer_index, so the order stored here is only
  -- the order the parent typed.
  -- Spelled out slot by slot because a check constraint may not hold a
  -- subquery, so jsonb_array_elements is not available here.
  CONSTRAINT quiz_bank_questions_choices_ck CHECK (
    jsonb_typeof(choices) = 'array'
    AND jsonb_array_length(choices) = 4
    AND jsonb_typeof(choices->0) = 'string' AND length(btrim(choices->>0)) > 0
    AND jsonb_typeof(choices->1) = 'string' AND length(btrim(choices->>1)) > 0
    AND jsonb_typeof(choices->2) = 'string' AND length(btrim(choices->>2)) > 0
    AND jsonb_typeof(choices->3) = 'string' AND length(btrim(choices->>3)) > 0
  )
);
CREATE INDEX IF NOT EXISTS quiz_bank_questions_bank_idx ON quiz_bank_questions (bank_id, seq);

-- What the portal reads: one row per bank with its questions counted, so it
-- can decide in one query whether a bank is big enough to serve.
CREATE OR REPLACE VIEW quiz_bank_summary AS
SELECT b.*, count(qq.question_id)::int AS questions,
       count(qq.difficulty)::int AS labelled,
       max(qq.updated_ts) AS last_question_ts
FROM quiz_banks b
LEFT JOIN quiz_bank_questions qq ON qq.bank_id = b.id
GROUP BY b.id;

-- ---------------------------------------------------------------------------
-- The rules of earning
-- ---------------------------------------------------------------------------
-- child_id NULL is the household row. Everything is nullable: a NULL column
-- means "no opinion, use the level below", so a parent can set one number for
-- one child without inheriting a snapshot of the rest.
CREATE TABLE IF NOT EXISTS earn_settings (
  child_id                 int REFERENCES children(id) ON DELETE CASCADE,
  quiz_cooldown_min        int,     -- how long a bank rests after a round, per child
  quiz_daily_cap_min       int,     -- most minutes a day a child can earn from quizzes
  mastery_bonus_min        int,     -- extra minutes for a perfect round
  default_minutes_per_pass int,     -- what a pass pays when the bank does not say
  set_by                   text,
  updated_ts               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earn_settings_cooldown_ck CHECK (quiz_cooldown_min IS NULL OR quiz_cooldown_min BETWEEN 0 AND 1440),
  CONSTRAINT earn_settings_cap_ck      CHECK (quiz_daily_cap_min IS NULL OR quiz_daily_cap_min BETWEEN 0 AND 600),
  CONSTRAINT earn_settings_bonus_ck    CHECK (mastery_bonus_min IS NULL OR mastery_bonus_min BETWEEN 0 AND 60),
  CONSTRAINT earn_settings_pass_ck     CHECK (default_minutes_per_pass IS NULL OR default_minutes_per_pass BETWEEN 1 AND 120)
);
-- At most one household row, and at most one row per child.
CREATE UNIQUE INDEX IF NOT EXISTS earn_settings_house_idx ON earn_settings ((child_id IS NULL)) WHERE child_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS earn_settings_child_idx ON earn_settings (child_id) WHERE child_id IS NOT NULL;

-- The one place the fallback chain is written down: this child, then the
-- household, then the numbers Hearth has always shipped. The portal and the
-- dashboard both read this view, so they cannot disagree.
CREATE OR REPLACE VIEW earn_settings_effective AS
SELECT c.id   AS child_id,
       c.name AS child,
       COALESCE(k.quiz_cooldown_min,        h.quiz_cooldown_min,        360) AS quiz_cooldown_min,
       COALESCE(k.quiz_daily_cap_min,       h.quiz_daily_cap_min,        30) AS quiz_daily_cap_min,
       COALESCE(k.mastery_bonus_min,        h.mastery_bonus_min,          5) AS mastery_bonus_min,
       COALESCE(k.default_minutes_per_pass, h.default_minutes_per_pass,  10) AS default_minutes_per_pass,
       (k.child_id IS NOT NULL) AS has_override
FROM children c
LEFT JOIN earn_settings k ON k.child_id = c.id
LEFT JOIN earn_settings h ON h.child_id IS NULL;

-- The portal and dashboard connect as the limited kids_app role. The portal
-- only reads banks; the dashboard is where a parent writes them, and it uses
-- the same connection, so writes are granted here rather than adding a second
-- role. Nothing in this file can change a firewall rule or a block.
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz_banks           TO kids_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz_bank_questions  TO kids_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON earn_settings        TO kids_app;
GRANT SELECT ON quiz_bank_summary, earn_settings_effective   TO kids_app;
