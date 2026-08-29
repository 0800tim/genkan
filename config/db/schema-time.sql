-- Daily time ledger per child. One row per child per local day.
CREATE TABLE IF NOT EXISTS time_ledger (
  child_id   int REFERENCES children(id) ON DELETE CASCADE,
  day        date NOT NULL,
  budget_min int NOT NULL DEFAULT 0,   -- base allowance for the day (from policy)
  bonus_min  int NOT NULL DEFAULT 0,   -- earned or granted extra
  used_min   int NOT NULL DEFAULT 0,   -- consumed so far
  PRIMARY KEY (child_id, day)
);

-- Earned/granted/spent time events (audit + "how did they earn it").
CREATE TABLE IF NOT EXISTS time_events (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  child_id  int REFERENCES children(id) ON DELETE CASCADE,
  minutes   int NOT NULL,              -- +grant/earn, -spend/penalty
  kind      text NOT NULL,             -- grant | earn | spend | penalty | reset
  reason    text,
  by        text
);

-- Earnable tasks (chores / study). unrot quizzes can post 'earn' events too.
CREATE TABLE IF NOT EXISTS tasks (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  minutes  int NOT NULL,               -- reward
  needs_approval boolean NOT NULL DEFAULT true,
  active   boolean NOT NULL DEFAULT true
);

-- Remaining minutes today for a child (budget + bonus - used), never below 0.
CREATE OR REPLACE VIEW time_remaining AS
SELECT c.id AS child_id, c.name,
       COALESCE(l.budget_min,0) AS budget_min,
       COALESCE(l.bonus_min,0)  AS bonus_min,
       COALESCE(l.used_min,0)   AS used_min,
       GREATEST(0, COALESCE(l.budget_min,0)+COALESCE(l.bonus_min,0)-COALESCE(l.used_min,0)) AS remaining_min
FROM children c
LEFT JOIN time_ledger l ON l.child_id=c.id AND l.day=CURRENT_DATE;
