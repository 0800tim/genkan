-- How long Genkan keeps things, and what deletes them.
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
  'How many days each table is kept. bin/genkan-prune enforces it nightly. A household may change any row; see PRIVACY-CHARTER.md.';

GRANT SELECT ON retention TO kids_app;

-- What each retained table is holding right now: its size on disk, roughly
-- how many rows, and the oldest one. The Settings page's Storage card and
-- `genkan retention show` read this, so a parent can see "16 MB, about 67,000
-- lookups, back to 29 Aug" without anybody needing the superuser.
--
-- Sizes come from pg_total_relation_size, which any role may call on a table
-- it can see, and the row count from the planner's estimate (n_live_tup),
-- which is why the page says "about". A count(*) over a year of dns_log on a
-- Raspberry Pi is not something a settings page should do on every load.
-- The oldest row is a real min() per table, and the CASE means only the one
-- branch that matches runs, so it costs one index probe for the tables that
-- have a timestamp index and a scan of the small ones that do not.
--
-- The view is owned by the schema loader, so a reader needs SELECT on the
-- view and nothing on the tables underneath. Read only by construction:
-- there is nothing here to write to.
CREATE OR REPLACE VIEW storage_status AS
SELECT r.what, r.keep_days, r.note,
       coalesce(pg_total_relation_size(c.oid), 0)::bigint AS bytes,
       coalesce(s.n_live_tup, 0)::bigint             AS rows_about,
       CASE r.what
         WHEN 'dns_log'        THEN (SELECT min(ts)   FROM dns_log)
         WHEN 'alerts'         THEN (SELECT min(ts)   FROM alerts)
         WHEN 'block_events'   THEN (SELECT min(ts)   FROM block_events)
         WHEN 'time_events'    THEN (SELECT min(ts)   FROM time_events)
         WHEN 'quiz_rounds'    THEN (SELECT min(ts)   FROM quiz_rounds)
         WHEN 'category_usage' THEN (SELECT min(day)::timestamptz FROM category_usage)
         WHEN 'service_usage'  THEN (SELECT min(day)::timestamptz FROM service_usage)
         WHEN 'dhcp_leases'    THEN (SELECT min(ends) FROM dhcp_leases)
         WHEN 'device_claims'  THEN (SELECT min(ts)   FROM device_claims)
       END AS oldest
FROM retention r
LEFT JOIN pg_class c ON c.relname = r.what AND c.relkind = 'r'
                     AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid;

COMMENT ON VIEW storage_status IS
  'Size, rough row count and oldest row for every table with a retention row. Read by the Settings page and genkan retention show.';

GRANT SELECT ON storage_status TO kids_app;
