-- The child page's optional AI summary: the one switch, and the summaries
-- a parent has asked for, kept so each one is written once and read many
-- times. See DECISIONS.md ("The child page: insights in the house, a summary
-- by an AI only when asked, and what leaves") and PRIVACY-CHARTER.md P1.
--
-- Nothing in this file is needed for the child page to work. Every number,
-- chart, finding and suggested reward on that page is computed in the house
-- by dashboard/kid-insights.mjs with no AI and no outbound request. This
-- file only exists for the one card that is off by default.
--
-- Load order: after schema.sql (children must exist) and after
-- schema-retention.sql (this file adds a retention row). Idempotent.

-- One row, the household's switch. Off by default, and turning it on is a
-- deliberate act on the dashboard that shows what would leave the house
-- first. The API key is NOT stored here: it lives in the gitignored
-- secrets.env as GENKAN_AI_SUMMARY_KEY, like every other secret, so a
-- database backup never carries it and a screenshot of a query never shows
-- it. With the switch on and no key set, the card says so and sends nothing.
-- The model is a setting because it is the cost lever: the default is the
-- cheap one, and a household that wants a better writer types a different
-- name on the child page.
CREATE TABLE IF NOT EXISTS ai_summary_settings (
  only_row   boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  enabled    boolean NOT NULL DEFAULT false,
  model      text    NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  updated_ts timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO ai_summary_settings (only_row) VALUES (true) ON CONFLICT DO NOTHING;

-- One summary per child, per period, per day. period is 'day' (one calendar
-- day; `day` is that day) or 'week' (a Monday-to-Sunday week; `day` is its
-- Monday). `complete` is true when the period had finished before the
-- summary was written: the nightly worker (bin/genkan-kid-summary) writes
-- complete rows for yesterday, and on a Monday a complete week built from
-- the seven daily summaries rather than from raw data. The on-demand buttons
-- on the child page write "so far" rows with complete=false, which the worker
-- replaces once the day or the week is over.
--
-- `brief` is the exact JSON that was sent, kept so a parent can always see
-- precisely what left the house for that summary, not what the code would
-- send today. `summary` is the text that came back, with the child referred
-- to as "the child": the name never goes out and is put back when the page
-- renders. tokens_in and tokens_out are what the API reported, so the page
-- can say what a summary actually cost rather than estimating.
CREATE TABLE IF NOT EXISTS kid_summaries (
  id         bigserial PRIMARY KEY,
  child_id   int  NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  period     text NOT NULL CHECK (period IN ('day', 'week')),
  day        date NOT NULL,
  complete   boolean NOT NULL DEFAULT false,
  brief      jsonb NOT NULL,
  summary    text  NOT NULL,
  model      text  NOT NULL,
  tokens_in  int,
  tokens_out int,
  created    timestamptz NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE (child_id, period, day)
);
CREATE INDEX IF NOT EXISTS kid_summaries_child_idx ON kid_summaries (child_id, created DESC);

-- A summary is an interpretation of a week, not a record of it, and a year
-- is long enough to look back over a term. bin/genkan-prune deletes older
-- rows nightly, the same way it prunes everything else in the retention table.
INSERT INTO retention (what, keep_days, note) VALUES
  ('kid_summaries', 365, 'Summaries a parent asked an AI to write, with the exact brief that was sent for each. Opinion about a child, so it does not need to outlive the year it describes.')
ON CONFLICT (what) DO NOTHING;

-- The dashboard connects as the limited kids_app role. It reads and writes
-- summaries and flips the switch; it cannot change the retention row.
GRANT SELECT, INSERT, UPDATE, DELETE ON kid_summaries TO kids_app;
GRANT USAGE ON SEQUENCE kid_summaries_id_seq TO kids_app;
GRANT SELECT, UPDATE ON ai_summary_settings TO kids_app;
