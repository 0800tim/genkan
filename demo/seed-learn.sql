-- The demo household's learning history. Loaded AFTER seed.sql, by
-- demo/reseed.sh, into the demo database only. Same rules as seed.sql: an
-- invented family, everything relative to now(), safe to run again.
--
-- Why a second file: seed.sql gives the three children rounds in three
-- general-interest banks (nz-geography, times-tables, madagascar-animals),
-- which is enough for the dashboard's charts and nothing for the portal's
-- Learning home, where a visiting parent picks a year and expects to see a
-- child part way through it. This file gives each child a few rounds in the
-- banks written for their own year, a study visit or two, and the badges
-- those rounds would have earned, so the page shows "passed", "read up",
-- "last go 5/10, not passed yet" and a real Next up rather than a wall of
-- "not started".
--
--   Piper (Year 10)  passing Science 9-10, stuck on Maths 9-10 (last round a
--                    fail, so Next up says come back), one pass in English.
--   Rangi (Year 7)   passing Maths 7-8, bounced back in Science 7-8, one
--                    failed go at NZ Histories 7-10.
--   Nova  (Year 3)   passing Numbers and Shapes, two goes at Our World, one
--                    failed go at Reading and Writing.

BEGIN;

-- Rangi is out of time today (seed.sql sets the ledger), and at home the
-- gateway's reconciler would have written this block within fifteen seconds.
-- The demo has no gateway, so the row is written here; a visitor who passes
-- a quiz as Rangi watches the portal lift it, which is the whole feature.
INSERT INTO category_state (child_id, category, blocked, since, set_by)
VALUES ((SELECT id FROM children WHERE name='Rangi'), 'internet', true, now() - interval '3 hours', 'out-of-time')
ON CONFLICT (child_id, category) DO UPDATE
  SET blocked = true, since = EXCLUDED.since, set_by = 'out-of-time';

-- Rounds in the banks written for each child's own year. `d` is days ago;
-- pass mark is 8 of 10 in every one of these banks.
CREATE TEMP TABLE d_learn (name text, bank text, d int, correct int, mins int) ;
INSERT INTO d_learn VALUES
 -- Piper
 ('Piper', 'nz-y9-10-science', 19, 6, 0), ('Piper', 'nz-y9-10-science', 16, 8, 10),
 ('Piper', 'nz-y9-10-science', 12, 9, 10), ('Piper', 'nz-y9-10-science',  8, 9, 10),
 ('Piper', 'nz-y9-10-science',  3, 10, 15),
 ('Piper', 'nz-y9-10-maths',   14, 8, 10), ('Piper', 'nz-y9-10-maths',    6, 7, 0),
 ('Piper', 'nz-y9-10-maths',    1, 6, 0),
 ('Piper', 'nz-y9-10-english',  5, 8, 10),
 -- Rangi
 ('Rangi', 'nz-y7-8-maths',    11, 8, 10), ('Rangi', 'nz-y7-8-maths',     8, 9, 10),
 ('Rangi', 'nz-y7-8-maths',     4, 8, 10), ('Rangi', 'nz-y7-8-maths',     2, 10, 15),
 ('Rangi', 'nz-y7-8-science',   7, 5, 0),  ('Rangi', 'nz-y7-8-science',   6, 8, 10),
 ('Rangi', 'nz-histories-secondary', 1, 6, 0),
 -- Nova (pass mark 6 of 8 in the Years 1 to 3 banks, 10 minutes a pass)
 ('Nova',  'nz-y1-3-maths',    13, 6, 10), ('Nova',  'nz-y1-3-maths',    10, 7, 10),
 ('Nova',  'nz-y1-3-maths',     7, 7, 10), ('Nova',  'nz-y1-3-maths',     5, 8, 15),
 ('Nova',  'nz-y1-3-maths',     2, 8, 15),
 ('Nova',  'nz-y1-3-world',     9, 5, 0),  ('Nova',  'nz-y1-3-world',     4, 6, 10),
 ('Nova',  'nz-y1-3-literacy',  1, 4, 0);

INSERT INTO quiz_rounds (ts, child_id, bank_id, asked, correct, passed, minutes, profile, avg_difficulty)
SELECT (CURRENT_DATE - l.d) + time '16:45' + (l.correct * interval '7 minutes'),
       c.id, l.bank,
       CASE WHEN l.name = 'Nova' THEN 8 ELSE 10 END,
       l.correct, l.mins > 0, l.mins,
       CASE WHEN l.correct >= 9 THEN 'confident' WHEN l.correct >= 7 THEN 'steady' ELSE 'building' END,
       round((2.2 + l.correct * 0.12)::numeric, 2)
FROM d_learn l JOIN children c ON c.name = l.name;

-- One answer row per question, so the per-question views have something to
-- read. Question ids are the banks' own prefixes with made-up numbers: the
-- ramp and the parent's "worst questions" table both tolerate an id that no
-- longer exists in the file.
INSERT INTO quiz_answers (round_id, seq, question_id, difficulty, correct)
SELECT r.id, s, r.bank_id || '-' || lpad(s::text, 3, '0'), 1 + ((s + r.id::int) % 5), s <= r.correct
FROM quiz_rounds r
JOIN children c ON c.id = r.child_id
JOIN generate_series(1, 10) s ON s <= r.asked
WHERE r.bank_id IN (SELECT DISTINCT bank FROM d_learn)
  AND NOT EXISTS (SELECT 1 FROM quiz_answers a WHERE a.round_id = r.id);

-- The passes paid out, through the same money trail as everything else.
INSERT INTO time_events (ts, child_id, minutes, kind, reason, "by")
SELECT r.ts, r.child_id, r.minutes, 'earn', 'quiz:' || r.bank_id, 'portal'
FROM quiz_rounds r
WHERE r.passed AND r.minutes > 0 AND r.bank_id IN (SELECT DISTINCT bank FROM d_learn)
  AND NOT EXISTS (SELECT 1 FROM time_events e WHERE e.child_id = r.child_id AND e.reason = 'quiz:' || r.bank_id AND e.ts = r.ts);

-- Who read up on what. Piper reads before she plays; Nova read the maths
-- page once with a parent; Rangi read the histories page after his fail.
INSERT INTO quiz_study_visits (ts, child_id, bank_id) VALUES
 (now() - interval '19 days' - interval '2 hours', (SELECT id FROM children WHERE name='Piper'), 'nz-y9-10-science'),
 (now() - interval '12 days' - interval '1 hour',  (SELECT id FROM children WHERE name='Piper'), 'nz-y9-10-science'),
 (now() - interval '6 days'  - interval '1 hour',  (SELECT id FROM children WHERE name='Piper'), 'nz-y9-10-maths'),
 (now() - interval '2 days',                       (SELECT id FROM children WHERE name='Piper'), 'nz-histories-secondary'),
 (now() - interval '20 hours',                     (SELECT id FROM children WHERE name='Rangi'), 'nz-histories-secondary'),
 (now() - interval '8 days'  - interval '1 hour',  (SELECT id FROM children WHERE name='Rangi'), 'nz-y7-8-maths'),
 (now() - interval '13 days' - interval '1 hour',  (SELECT id FROM children WHERE name='Nova'),  'nz-y1-3-maths');

-- The badges those rounds would have earned (dashboard/badges.mjs). Written
-- directly because the portal only awards at grading time, and a visitor
-- should see a child with a few, not a house where nobody has ever earned one.
INSERT INTO child_badges (child_id, badge_id, scope, ts, meta)
SELECT c.id, b.badge, b.scope, now() - (b.d || ' days')::interval, b.meta::jsonb
FROM (VALUES
 ('Piper', 'first_pass',     '',                 40, '{}'),
 ('Piper', 'first_perfect',  '',                  3, '{}'),
 ('Piper', 'ten_passes',     '',                 20, '{}'),
 ('Piper', 'explorer',       'nz-geography',     40, '{"bank_title":"New Zealand Geography"}'),
 ('Piper', 'explorer',       'nz-y9-10-science', 19, '{"bank_title":"Science, Years 9 and 10"}'),
 ('Piper', 'explorer',       'nz-y9-10-maths',   14, '{"bank_title":"Maths, Years 9 and 10"}'),
 ('Piper', 'explorer',       'nz-y9-10-english',  5, '{"bank_title":"English, Years 9 and 10"}'),
 ('Piper', 'read_then_pass', 'nz-y9-10-science', 16, '{"bank_title":"Science, Years 9 and 10"}'),
 ('Piper', 'comeback',       '',                 16, '{}'),
 ('Piper', 'earn_hour_week', '',                  9, '{}'),
 ('Rangi', 'first_pass',     '',                 38, '{}'),
 ('Rangi', 'ten_passes',     '',                 12, '{}'),
 ('Rangi', 'explorer',       'times-tables',     38, '{"bank_title":"Times Tables"}'),
 ('Rangi', 'explorer',       'nz-y7-8-maths',    11, '{"bank_title":"Maths, Years 7 and 8"}'),
 ('Rangi', 'explorer',       'nz-y7-8-science',   7, '{"bank_title":"Science, Years 7 and 8"}'),
 ('Rangi', 'explorer',       'nz-histories-secondary', 1, '{"bank_title":"Aotearoa New Zealand Histories, Years 7 to 10"}'),
 ('Rangi', 'comeback',       '',                  6, '{}'),
 ('Rangi', 'first_perfect',  '',                  2, '{}'),
 ('Nova',  'first_pass',     '',                 30, '{}'),
 ('Nova',  'explorer',       'madagascar-animals', 30, '{"bank_title":"Animals of Madagascar"}'),
 ('Nova',  'explorer',       'nz-y1-3-maths',    13, '{"bank_title":"Numbers and Shapes, Years 1 to 3"}'),
 ('Nova',  'explorer',       'nz-y1-3-world',     9, '{"bank_title":"Our World, Years 1 to 3"}'),
 ('Nova',  'explorer',       'nz-y1-3-literacy',  1, '{"bank_title":"Reading and Writing, Years 1 to 3"}'),
 ('Nova',  'first_perfect',  '',                  5, '{}'),
 ('Nova',  'comeback',       '',                  4, '{}')
) AS b(name, badge, scope, d, meta)
JOIN children c ON c.name = b.name
ON CONFLICT (child_id, badge_id, scope) DO NOTHING;

DROP TABLE d_learn;

COMMIT;

SELECT (SELECT count(*) FROM quiz_rounds)       AS quiz_rounds,
       (SELECT count(*) FROM quiz_study_visits) AS study_visits,
       (SELECT count(*) FROM child_badges)      AS badges;
