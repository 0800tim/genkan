-- How long Hearth keeps things, and what deletes them.
--
-- PRIVACY-CHARTER.md commits that nothing leaves the house. It does not commit
-- that everything stays in it forever, and until now nothing pruned anything:
-- dns_log, alerts, time_events, quiz_answers, category_usage and service_usage
-- all grew without limit. A complete browsing history of a child's entire
-- adolescence, sitting in a cupboard, is not what a parent agreed to even if it
-- never leaves the house. The charter names this as its own most likely breach.
--
-- Defaults are deliberately short for the detailed logs and long for the
-- aggregates, because a parent wants "how much video last term", not "which
-- domain at 4.02pm eight months ago".

CREATE TABLE IF NOT EXISTS retention (
  what      text PRIMARY KEY,
  keep_days int  NOT NULL CHECK (keep_days BETWEEN 1 AND 3650),
  note      text
);

INSERT INTO retention (what, keep_days, note) VALUES
  ('dns_log',       30,  'Every domain a device asked for. The most sensitive table in the database and the one with the shortest life. Thirty days is enough to answer "what happened last week" and not enough to build a picture of a child.'),
  ('alerts',        180, 'Kept longer because a parent may want to look back at a pattern, and because an acknowledged alert is already a decision somebody made.'),
  ('block_events',  365, 'The audit trail of what was blocked and by whom. A year, so a household can see a year.'),
  ('time_events',   730, 'Minutes earned and spent. An aggregate, not a record of what was watched, so it can safely live longer and makes the year-on-year view possible.'),
  ('quiz_rounds',   730, 'How a child has been going. Two years lets a parent see real progress. quiz_answers has no timestamp of its own and cascades from here, so pruning a round takes its answers with it.'),
  ('category_usage',730, 'Daily minutes per category. Small, aggregated, and what the Week and Trends pages are built on.'),
  ('service_usage', 730, 'Daily minutes per service. Same reasoning.'),
  ('dhcp_leases',   30,  'Which address a device had. Operational, not interesting after a month.'),
  ('device_claims', 365, 'Who said a device was theirs, including the wrong-PIN attempts a parent should be able to see.')
ON CONFLICT (what) DO NOTHING;

COMMENT ON TABLE retention IS
  'How many days each table is kept. bin/kidnet-prune enforces it nightly. A household may change any row; see PRIVACY-CHARTER.md.';

GRANT SELECT ON retention TO kids_app;
