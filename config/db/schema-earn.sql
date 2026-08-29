-- Learn-to-earn: chore claims awaiting a parent's decision.
-- Quizzes are the no-approval path (the portal grades them and credits
-- directly, with cooldowns and a daily cap). Chores are claims: the kid
-- taps "I did the dishes" on the portal, Dad approves on the dashboard,
-- the minutes land through the same time_events audit trail as everything
-- else.
CREATE TABLE IF NOT EXISTS earn_claims (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT now(),
  child_id   int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  task_id    int NOT NULL REFERENCES tasks(id),
  status     text NOT NULL DEFAULT 'pending',   -- pending | approved | declined
  decided_by text,
  decided_ts timestamptz
);
CREATE INDEX IF NOT EXISTS earn_claims_open_idx ON earn_claims (status) WHERE status='pending';

-- The portal and dashboard connect as the limited kids_app role.
GRANT SELECT, INSERT, UPDATE ON earn_claims TO kids_app;
GRANT USAGE ON SEQUENCE earn_claims_id_seq TO kids_app;
