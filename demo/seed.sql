-- The demo household. Entirely made up: no real person, device, address or
-- network appears anywhere in this file, and it is only ever loaded into the
-- demo database (demo/compose.yaml), never into a household's own.
--
-- Everything is written relative to now(), so re-running it produces a fresh
-- looking six weeks whenever it is run. demo/reseed.sh runs it nightly for
-- exactly that reason: a demo with a dead chart is worse than no demo.
--
-- The family:
--   Callum, Marama   household adults, no limits, never caught by a kids' control
--   Piper   14       standard tier. The story: her gaming is trending down over
--                    six weeks while her learning minutes climb, which is what
--                    the goals feature is for.
--   Rangi   11       young tier. Video heavy, steady, hits the video cap often.
--   Nova     7       young tier. Light use, mostly on the shared tablet.
--   Ari     10       guest child, here for the afternoon. Filtered like a kid,
--                    no budget, earns nothing, out of the family's numbers.
--   Dorothy 68       guest adult (visiting grandmother). Streams as much as she
--                    likes and no kids' control touches her.

BEGIN;

-- A demo database only. Everything below is rebuilt from scratch each time.
TRUNCATE children, devices, tasks, dns_log, dhcp_leases, alerts, block_events
  RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
INSERT INTO children (name, age, policy_tier, kind, active, arrived, notes) VALUES
 ('Callum',  44, 'adult',    'adult',       true, NULL, 'Dad'),
 ('Marama',  41, 'adult',    'adult',       true, NULL, 'Mum'),
 ('Piper',   14, 'standard', 'child',       true, NULL, 'Year 10'),
 ('Rangi',   11, 'young',    'child',       true, NULL, 'Year 7'),
 ('Nova',     7, 'young',    'child',       true, NULL, 'Year 3'),
 ('Ari',     10, 'guest',    'guest-child', true, now() - interval '3 hours',  'Rangi''s friend, over for the afternoon'),
 ('Dorothy', 68, 'guest',    'guest-adult', true, now() - interval '2 days',   'Nana, staying the week');

-- ---------------------------------------------------------------------------
-- Devices. MACs are all in 02:00:00: , the locally administered documentation
-- range, so not one of them can collide with real hardware anywhere.
-- ---------------------------------------------------------------------------
INSERT INTO devices (child_id, label, mac, reserved_ip, kind, category, vendor, hostname, is_active, first_seen, last_seen, present_at) VALUES
 -- Piper
 ((SELECT id FROM children WHERE name='Piper'),   'Piper''s phone',      '02:00:00:11:01:01', '192.168.60.21', 'phone',   'personal', 'Samsung',  'piper-phone',  true, now()-interval '210 days', now()-interval '40 seconds', now()-interval '40 seconds'),
 ((SELECT id FROM children WHERE name='Piper'),   'Piper''s laptop',     '02:00:00:11:01:02', '192.168.60.22', 'laptop',  'personal', 'Lenovo',   'piper-laptop', true, now()-interval '190 days', now()-interval '2 minutes',  now()-interval '2 minutes'),
 -- Rangi
 ((SELECT id FROM children WHERE name='Rangi'),   'Rangi''s Switch',     '02:00:00:11:02:01', '192.168.60.31', 'console', 'personal', 'Nintendo', 'rangi-switch', true, now()-interval '300 days', now()-interval '1 minute',   now()-interval '1 minute'),
 ((SELECT id FROM children WHERE name='Rangi'),   'Rangi''s tablet',     '02:00:00:11:02:02', '192.168.60.32', 'tablet',  'personal', 'Amazon',   'rangi-tablet', true, now()-interval '260 days', now()-interval '9 minutes',  now()-interval '3 hours'),
 -- Nova
 ((SELECT id FROM children WHERE name='Nova'),    'Nova''s tablet',      '02:00:00:11:03:01', '192.168.60.41', 'tablet',  'personal', 'Apple',    'nova-tablet',  true, now()-interval '150 days', now()-interval '3 minutes',  now()-interval '3 minutes'),
 -- Adults
 ((SELECT id FROM children WHERE name='Marama'),  'Marama''s phone',     '02:00:00:11:04:01', '192.168.60.11', 'phone',   'personal', 'Apple',    'marama-phone', true, now()-interval '400 days', now()-interval '30 seconds', now()-interval '30 seconds'),
 ((SELECT id FROM children WHERE name='Callum'),  'Callum''s phone',     '02:00:00:11:05:01', '192.168.60.12', 'phone',   'personal', 'Google',   'callum-phone', true, now()-interval '400 days', now()-interval '6 hours',    now()-interval '6 hours'),
 ((SELECT id FROM children WHERE name='Callum'),  'Callum''s laptop',    '02:00:00:11:05:02', '192.168.60.13', 'laptop',  'personal', 'Dell',     'callum-work',  true, now()-interval '380 days', now()-interval '4 minutes',  now()-interval '4 minutes'),
 -- Guests
 ((SELECT id FROM children WHERE name='Ari'),     'Ari''s phone',        '02:00:00:11:06:01', '192.168.60.61', 'phone',   'personal', 'Xiaomi',   'ari-phone',    true, now()-interval '3 hours',  now()-interval '2 minutes',  now()-interval '2 minutes'),
 ((SELECT id FROM children WHERE name='Dorothy'), 'Dorothy''s iPad',     '02:00:00:11:07:01', '192.168.60.62', 'tablet',  'personal', 'Apple',    'dorothy-ipad', true, now()-interval '2 days',   now()-interval '1 minute',   now()-interval '1 minute'),
 -- Nobody has claimed this one yet: it is what the naming queue is for.
 (NULL,                                           'Unknown tablet',      '02:00:00:11:09:01', '192.168.60.88', 'tablet',  'personal', 'Lenovo',   'android-4a91', true, now()-interval '2 hours',  now()-interval '5 minutes',  now()-interval '5 minutes'),
 -- Shared family devices. The household's, not one child's: nobody's minutes
 -- pay for the family film, and each one carries a filter level of its own.
 (NULL, 'Lounge TV',        '02:00:00:55:01:01', '192.168.60.70',  'tv',      'shared',    'LG',         'lounge-tv',      true, now()-interval '520 days', now()-interval '2 minutes', now()-interval '2 minutes'),
 (NULL, 'Family iPad',      '02:00:00:55:01:02', '192.168.60.71',  'tablet',  'shared',    'Apple',      'family-ipad',    true, now()-interval '330 days', now()-interval '1 minute',  now()-interval '1 minute'),
 (NULL, 'Kitchen display',  '02:00:00:55:01:03', '192.168.60.72',  'tablet',  'shared',    'Google',     'kitchen-hub',    true, now()-interval '240 days', now()-interval '5 minutes', now()-interval '5 minutes'),
 -- Smart home. Never assigned to a person, never metered, never cut at bedtime.
 (NULL, 'Lounge speaker',   '02:00:00:22:01:01', '192.168.60.101', 'speaker', 'iot',       'Sonos',      'lounge-speaker', true, now()-interval '500 days', now()-interval '1 minute',  now()-interval '1 minute'),
 (NULL, 'Front door camera','02:00:00:22:01:02', '192.168.60.102', 'camera',  'iot',       'Reolink',    'door-cam',       true, now()-interval '420 days', now()-interval '30 seconds',now()-interval '30 seconds'),
 (NULL, 'Robot vacuum',     '02:00:00:22:01:03', '192.168.60.103', 'vacuum',  'iot',       'Roborock',   'vacuum',         true, now()-interval '300 days', now()-interval '4 hours',   now()-interval '4 hours'),
 (NULL, 'Media server',     '02:00:00:33:01:01', '192.168.60.150', 'other',   'appliance', 'Intel',      'media-server',   true, now()-interval '600 days', now()-interval '1 minute',  now()-interval '1 minute'),
 (NULL, 'Living room AP',   '02:00:00:44:01:01', '192.168.60.2',   'ap',      'infra',     'Ubiquiti',   'kids-ap',        true, now()-interval '600 days', now()-interval '20 seconds',now()-interval '20 seconds');

-- The shared devices' own filter levels, and the two sweep tick boxes. The
-- kitchen display is the one the owner described: it plays music through
-- dinner, so it is deliberately ticked OUT of the dinner pause while staying
-- in the whole-house cut. The other two are left on their defaults, which is
-- why the Devices page shows them as "(default)" rather than as a choice
-- somebody made.
UPDATE devices SET policy_tier='teen'     WHERE label='Lounge TV';
UPDATE devices SET policy_tier='standard' WHERE label='Family iPad';
UPDATE devices SET policy_tier='standard', caught_by_dinner=false WHERE label='Kitchen display';

-- Active leases, for the devices that are actually in the house right now.
INSERT INTO dhcp_leases (ip, mac, hostname, device_id, starts, ends, active)
SELECT d.reserved_ip, d.mac, d.hostname, d.id, now()-interval '6 hours', now()+interval '6 hours', true
FROM devices d WHERE d.present_at > now() - interval '20 minutes';

-- ---------------------------------------------------------------------------
-- Per-category caps. Audio and schoolwork are never metered, so never capped.
-- ---------------------------------------------------------------------------
INSERT INTO category_budgets (child_id, category, daily_min) VALUES
 ((SELECT id FROM children WHERE name='Piper'), 'gaming', 90),
 ((SELECT id FROM children WHERE name='Piper'), 'video',  60),
 ((SELECT id FROM children WHERE name='Piper'), 'social', 45),
 ((SELECT id FROM children WHERE name='Rangi'), 'gaming', 60),
 ((SELECT id FROM children WHERE name='Rangi'), 'video',  45),
 ((SELECT id FROM children WHERE name='Nova'),  'gaming', 30),
 ((SELECT id FROM children WHERE name='Nova'),  'video',  40);

-- ---------------------------------------------------------------------------
-- Six weeks of history. Every figure below is derived from the day offset, so
-- the curves have a shape rather than being noise: weekends are busier, and
-- Piper's gaming falls away over the window while her learning minutes climb.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE d_days AS
SELECT g AS ago,
       (CURRENT_DATE - g)                        AS day,
       extract(dow FROM (CURRENT_DATE - g))::int AS dow,
       (extract(dow FROM (CURRENT_DATE - g))::int IN (0,6)) AS weekend,
       (g / 55.0)                                AS old            -- 1 = six weeks ago, 0 = today
FROM generate_series(0, 55) g;

-- Daily time ledger. `budget_min` follows the tier and the day of the week,
-- exactly as bin/kidnet-daily would have written it.
INSERT INTO time_ledger (child_id, day, budget_min, bonus_min, used_min)
SELECT c.id, d.day,
  CASE WHEN d.weekend THEN p.daily_budget_weekend_min ELSE p.daily_budget_school_min END,
  b.bonus,
  LEAST(
    CASE WHEN d.weekend THEN p.daily_budget_weekend_min ELSE p.daily_budget_school_min END + b.bonus,
    GREATEST(0, b.want)
  )
FROM d_days d
JOIN children c ON c.kind = 'child'
JOIN policies p ON p.tier = c.policy_tier
CROSS JOIN LATERAL (
  SELECT
    CASE c.name
      WHEN 'Piper' THEN (10 + round(45 * (1 - d.old)) + CASE WHEN d.dow IN (2,4) THEN 15 ELSE 0 END)::int
      WHEN 'Rangi' THEN (10 + round(random() * 25))::int
      ELSE            (round(random() * 20))::int
    END AS bonus,
    CASE c.name
      WHEN 'Piper' THEN round(150 + 60*d.old + CASE WHEN d.weekend THEN 70 ELSE 0 END + (random()-0.5)*40)::int
      WHEN 'Rangi' THEN round(85  + 15*d.old + CASE WHEN d.weekend THEN 80 ELSE 0 END + (random()-0.5)*35)::int
      ELSE            round(45  + CASE WHEN d.weekend THEN 45 ELSE 0 END + (random()-0.5)*25)::int
    END AS want
) b
WHERE c.name IN ('Piper','Rangi','Nova');

-- One child is out of time TODAY, on purpose. The page a kid meets when their
-- time runs out is the most important screen in the product, and a demo where
-- everybody has minutes left never shows it. Rangi has used the lot, so the
-- portal greets them with the earn-it-back page rather than the hub.
UPDATE time_ledger SET used_min = budget_min + bonus_min
 WHERE day = CURRENT_DATE
   AND child_id = (SELECT id FROM children WHERE name = 'Rangi');

-- The metered categories. Gaming, video and social only: audio and schoolwork
-- are deliberately free, which is the whole point of METERING.md.
INSERT INTO category_usage (child_id, day, category, used_min)
SELECT c.id, d.day, v.category, GREATEST(0, v.mins)::int
FROM d_days d
JOIN children c ON c.kind = 'child'
CROSS JOIN LATERAL (VALUES
  ('gaming',
    CASE c.name
      -- The story: 100+ minutes a day six weeks ago, about 35 now.
      WHEN 'Piper' THEN round(30 + 75*d.old + CASE WHEN d.weekend THEN 30 ELSE 0 END + (random()-0.5)*22)
      WHEN 'Rangi' THEN round(45 + 10*d.old + CASE WHEN d.weekend THEN 25 ELSE 0 END + (random()-0.5)*20)
      ELSE            round(15 + CASE WHEN d.weekend THEN 15 ELSE 0 END + (random()-0.5)*12)
    END),
  ('video',
    CASE c.name
      WHEN 'Piper' THEN round(40 + CASE WHEN d.weekend THEN 35 ELSE 0 END + (random()-0.5)*20)
      WHEN 'Rangi' THEN round(48 + CASE WHEN d.weekend THEN 40 ELSE 0 END + (random()-0.5)*22)
      ELSE            round(28 + CASE WHEN d.weekend THEN 25 ELSE 0 END + (random()-0.5)*16)
    END),
  ('social',
    CASE c.name
      WHEN 'Piper' THEN round(35 + CASE WHEN d.weekend THEN 20 ELSE 0 END + (random()-0.5)*18)
      WHEN 'Rangi' THEN round(8  + (random()-0.5)*8)
      ELSE            0
    END)
) AS v(category, mins)
WHERE c.name IN ('Piper','Rangi','Nova') AND v.mins > 0;

-- Per service. Bytes are real traffic in the household; here they are minutes
-- times a plausible bitrate per service, so "bytes are not minutes" still reads
-- correctly on the Trends page.
INSERT INTO service_usage (child_id, day, service_id, bytes, used_min)
SELECT u.child_id, u.day, s.id,
       (u.used_min * m.share * m.mb_per_min * 1000000)::bigint,
       GREATEST(1, round(u.used_min * m.share))::int
FROM category_usage u
JOIN (VALUES
 ('gaming','roblox',    0.45, 8.0),
 ('gaming','minecraft', 0.25, 3.0),
 ('gaming','fortnite',  0.18, 14.0),
 ('gaming','steam',     0.12, 20.0),
 ('video','youtube',    0.52, 26.0),
 ('video','netflix',    0.22, 42.0),
 ('video','disneyplus', 0.14, 40.0),
 ('video','tiktok',     0.12, 30.0),
 ('social','snapchat',  0.46, 6.0),
 ('social','instagram', 0.38, 9.0),
 ('social','twitch',    0.16, 35.0)
) AS m(cat, svc, share, mb_per_min) ON m.cat = u.category
JOIN services s ON s.name = m.svc
WHERE round(u.used_min * m.share) >= 1;

-- Audio and schoolwork are never metered, but they are still measured, and
-- showing them is how a parent sees that a big number is not a bad number.
INSERT INTO service_usage (child_id, day, service_id, bytes, used_min)
SELECT c.id, d.day, s.id,
       (v.mins * v.mb * 1000000)::bigint, v.mins
FROM d_days d
JOIN children c ON c.kind='child'
CROSS JOIN LATERAL (VALUES
 ('spotify',     round(25 + random()*45)::int, 1.2),
 ('khanacademy', CASE c.name WHEN 'Piper' THEN round(8 + 40*(1-d.old) + random()*10)::int
                             ELSE round(random()*22)::int END, 1.5)
) AS v(svc, mins, mb)
JOIN services s ON s.name = v.svc
WHERE v.mins > 0 AND c.name IN ('Piper','Rangi','Nova')
ON CONFLICT (child_id, day, service_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Learn to earn
-- ---------------------------------------------------------------------------
INSERT INTO tasks (name, minutes, needs_approval, active, everyone, emoji, set_by) VALUES
 ('Dishes done',        30, true,  true, true,  '🧽', 'demo'),
 ('Room tidy',          20, true,  true, true,  '🧹', 'demo'),
 ('Homework finished',  45, true,  true, true,  '📓', 'demo'),
 ('20 min reading',     20, true,  true, true,  '📖', 'demo'),
 ('Feed the chickens',  15, true,  true, true,  '🐔', 'demo'),
 ('Mow the lawn',       60, true,  true, false, '🌱', 'demo'),
 ('Study quiz',         15, false, true, true,  '🧠', 'demo');

-- Per-child offers. The mower is the 14 year old's job and pays her properly;
-- the 7 year old is not offered it at all, which is the point of the table.
INSERT INTO task_offers (task_id, child_id, active, minutes, set_by) VALUES
 ((SELECT id FROM tasks WHERE name='Mow the lawn'),      (SELECT id FROM children WHERE name='Piper'), true,  75,   'demo'),
 ((SELECT id FROM tasks WHERE name='Feed the chickens'), (SELECT id FROM children WHERE name='Nova'),  true,  20,   'demo'),
 ((SELECT id FROM tasks WHERE name='Homework finished'), (SELECT id FROM children WHERE name='Nova'),  false, NULL, 'demo'),
 ((SELECT id FROM tasks WHERE name='Dishes done'),       (SELECT id FROM children WHERE name='Rangi'), true,  25,   'demo');

-- Which quiz banks are on which child's list, and what a pass is worth to them.
INSERT INTO quiz_settings (child_id, bank_id, enabled, minutes, set_by) VALUES
 ((SELECT id FROM children WHERE name='Piper'), 'nz-geography',       true,  12,   'demo'),
 ((SELECT id FROM children WHERE name='Piper'), 'science-basics',     true,  15,   'demo'),
 ((SELECT id FROM children WHERE name='Piper'), 'nz-road-code',       true,  NULL, 'demo'),
 ((SELECT id FROM children WHERE name='Piper'), 'times-tables',       false, NULL, 'demo'),
 ((SELECT id FROM children WHERE name='Rangi'), 'times-tables',       true,  10,   'demo'),
 ((SELECT id FROM children WHERE name='Rangi'), 'flags-world',        true,  NULL, 'demo'),
 ((SELECT id FROM children WHERE name='Rangi'), 'madagascar-animals', true,  NULL, 'demo'),
 ((SELECT id FROM children WHERE name='Nova'),  'times-tables',       true,  10,   'demo'),
 ((SELECT id FROM children WHERE name='Nova'),  'madagascar-animals', true,  12,   'demo'),
 ((SELECT id FROM children WHERE name='Nova'),  'nz-road-code',       false, NULL, 'demo');

-- Quiz passes, as time_events. Piper's climb is the visible half of her story:
-- the gaming line falls, this one rises.
INSERT INTO time_events (ts, child_id, minutes, kind, reason, "by")
SELECT d.day + (time '16:20') + (random() * interval '3 hours'),
       c.id, v.mins, 'earn', 'quiz:' || v.bank, 'portal'
FROM d_days d
JOIN children c ON c.kind='child'
CROSS JOIN LATERAL (VALUES
 (CASE c.name WHEN 'Piper' THEN 'nz-geography' WHEN 'Rangi' THEN 'times-tables' ELSE 'madagascar-animals' END,
  CASE c.name WHEN 'Piper' THEN 12 WHEN 'Rangi' THEN 10 ELSE 12 END,
  CASE c.name WHEN 'Piper' THEN 0.30 + 0.55*(1-d.old) ELSE 0.42 END),
 (CASE c.name WHEN 'Piper' THEN 'science-basics' WHEN 'Rangi' THEN 'flags-world' ELSE 'times-tables' END,
  CASE c.name WHEN 'Piper' THEN 15 WHEN 'Rangi' THEN 10 ELSE 10 END,
  CASE c.name WHEN 'Piper' THEN 0.22 + 0.45*(1-d.old) ELSE 0.30 END)
) AS v(bank, mins, chance)
WHERE c.name IN ('Piper','Rangi','Nova') AND random() < v.chance;

-- Chore claims. The old ones were decided, the newest three are still waiting,
-- which is what puts a queue on the home page.
INSERT INTO earn_claims (ts, child_id, task_id, status, decided_by, decided_ts)
SELECT d.day + (time '17:40') + (random() * interval '2 hours'),
       c.id, t.id,
       CASE WHEN random() < 0.88 THEN 'approved' ELSE 'declined' END,
       'Marama', d.day + (time '19:10')
FROM d_days d
JOIN children c ON c.kind='child'
JOIN LATERAL (SELECT id, name, minutes FROM tasks WHERE needs_approval AND active ORDER BY random() LIMIT 1) t ON true
WHERE d.ago > 0 AND c.name IN ('Piper','Rangi','Nova') AND random() < 0.42;

-- The approved ones paid out, through the same audit trail as everything else.
INSERT INTO time_events (ts, child_id, minutes, kind, reason, "by")
SELECT ec.decided_ts, ec.child_id, COALESCE(o.minutes, t.minutes), 'earn', 'task:' || t.name, 'Marama'
FROM earn_claims ec
JOIN tasks t ON t.id = ec.task_id
LEFT JOIN task_offers o ON o.task_id = t.id AND o.child_id = ec.child_id
WHERE ec.status = 'approved';

-- Waiting on a parent right now.
INSERT INTO earn_claims (ts, child_id, task_id, status) VALUES
 (now() - interval '25 minutes', (SELECT id FROM children WHERE name='Rangi'), (SELECT id FROM tasks WHERE name='Dishes done'),      'pending'),
 (now() - interval '1 hour',     (SELECT id FROM children WHERE name='Nova'),  (SELECT id FROM tasks WHERE name='Feed the chickens'),'pending'),
 (now() - interval '2 hours',    (SELECT id FROM children WHERE name='Piper'), (SELECT id FROM tasks WHERE name='Mow the lawn'),     'pending');

-- Parent bonuses. A gift, never a goal metric.
INSERT INTO time_events (ts, child_id, minutes, kind, reason, "by") VALUES
 (now() - interval '2 days'  - interval '4 hours', (SELECT id FROM children WHERE name='Nova'),  30, 'grant', 'sat through her sister''s prizegiving', 'Callum'),
 (now() - interval '5 days',                       (SELECT id FROM children WHERE name='Rangi'), 20, 'grant', 'rainy Sunday',                          'Marama'),
 (now() - interval '9 days',                       (SELECT id FROM children WHERE name='Piper'), 45, 'grant', 'helped with the shed',                  'Callum');

-- Two out-of-time moments and a docked evening: the honest bits.
INSERT INTO time_events (ts, child_id, minutes, kind, reason, "by") VALUES
 (now() - interval '3 days' - interval '5 hours', (SELECT id FROM children WHERE name='Rangi'), -20, 'penalty', 'phone at the dinner table', 'Marama'),
 (now() - interval '11 days',                     (SELECT id FROM children WHERE name='Piper'), -30, 'penalty', 'up past midnight on a school night', 'Callum');

-- Graded quiz rounds, passes and fails, so the difficulty ramp has form to read.
INSERT INTO quiz_rounds (ts, child_id, bank_id, asked, correct, passed, minutes, profile, avg_difficulty)
SELECT d.day + (time '16:30') + (random() * interval '3 hours'),
       c.id,
       CASE c.name WHEN 'Piper' THEN 'nz-geography' WHEN 'Rangi' THEN 'times-tables' ELSE 'madagascar-animals' END,
       10, r.correct, r.correct >= 7,
       CASE WHEN r.correct >= 7 THEN 12 ELSE 0 END,
       CASE WHEN r.correct >= 9 THEN 'confident' WHEN r.correct >= 6 THEN 'steady' ELSE 'building' END,
       round((2.0 + random()*1.8)::numeric, 2)
FROM d_days d
JOIN children c ON c.kind='child'
CROSS JOIN LATERAL (SELECT LEAST(10, GREATEST(3, round(5 + 3*(1-d.old) + (random()-0.4)*3)::int)) AS correct) r
WHERE c.name IN ('Piper','Rangi','Nova') AND d.ago < 30 AND random() < 0.5;

INSERT INTO quiz_answers (round_id, seq, question_id, difficulty, correct)
SELECT r.id, s, 'q' || s, 1 + ((s + r.id) % 5), s <= r.correct
FROM quiz_rounds r, generate_series(1, 10) s;

-- ---------------------------------------------------------------------------
-- Goals. One agreed number each. Never enforce anything.
-- ---------------------------------------------------------------------------
INSERT INTO goals (child_id, metric, direction, target_min, note, set_by) VALUES
 ((SELECT id FROM children WHERE name='Piper'), 'gaming', 'at_most',  300, 'Agreed at the kitchen table, five hours a week', 'Marama'),
 ((SELECT id FROM children WHERE name='Piper'), 'quiz',   'at_least', 120, 'Two hours of quizzes a week',                    'Piper'),
 ((SELECT id FROM children WHERE name='Rangi'), 'video',  'at_most',  360, 'Six hours of video a week',                      'Callum'),
 ((SELECT id FROM children WHERE name='Nova'),  'earned', 'at_least',  60, 'An hour a week earned rather than given',        'Marama');

-- ---------------------------------------------------------------------------
-- What is blocked right now, and the audit trail of how it got that way.
-- ---------------------------------------------------------------------------
INSERT INTO category_state (child_id, category, blocked, since, set_by) VALUES
 ((SELECT id FROM children WHERE name='Rangi'), 'gaming', true, now() - interval '40 minutes', 'Marama');

INSERT INTO block_events (ts, target_type, target_ref, action, source, actor, reason) VALUES
 (now() - interval '40 minutes', 'child', 'Rangi',  'off', 'manual',   'Marama', 'gaming off until the dishes are done'),
 (now() - interval '3 hours',    'child', 'Piper',  'on',  'manual',   'Callum', 'homework finished'),
 (now() - interval '5 hours',    'child', 'Piper',  'off', 'schedule', 'hearth', 'study mode, weekday afternoon'),
 (now() - interval '1 day',      'all',   'kids',   'on',  'manual',   'Marama', 'dinner over'),
 (now() - interval '1 day' - interval '45 minutes', 'all', 'kids', 'off', 'dinner', 'Marama', 'family pause'),
 (now() - interval '2 days',     'child', 'Nova',   'on',  'manual',   'Callum', NULL),
 (now() - interval '2 days' - interval '2 hours', 'child', 'Nova', 'off', 'agent', 'hearth', 'out of time'),
 (now() - interval '3 days',     'child', 'Rangi',  'off', 'agent',    'hearth', 'video cap reached'),
 (now() - interval '4 days',     'all',   'kids',   'off', 'schedule', 'hearth', '9pm on a school night'),
 (now() - interval '5 days',     'child', 'Piper',  'on',  'manual',   'Marama', NULL),
 (now() - interval '6 days',     'child', 'Ari',    'on',  'manual',   'Marama', 'guest arrived'),
 (now() - interval '7 days',     'all',   'kids',   'on',  'manual',   'Callum', 'Saturday');

-- ---------------------------------------------------------------------------
-- Alerts. Enough to show the strip works, nothing frightening: these are
-- conversation prompts, and the demo should read that way too.
-- ---------------------------------------------------------------------------
INSERT INTO alerts (ts, child_id, severity, category, domain, detail, acknowledged) VALUES
 (now() - interval '90 minutes', (SELECT id FROM children WHERE name='Piper'), 'info', 'proxy-vpn', 'nordvpn.com',
  'Looked up a VPN download. Usually curiosity, occasionally a way round the filter. Worth asking.', false),
 (now() - interval '6 hours',    (SELECT id FROM children WHERE name='Rangi'), 'info', 'time',      NULL,
  'Hit the video cap three days running. The cap may simply be in the wrong place.', false),
 (now() - interval '2 days',     (SELECT id FROM children WHERE name='Piper'), 'warn', 'tor',       'torproject.org',
  'Read the Tor project site. Talked about it, she was researching a school topic on privacy.', true),
 (now() - interval '9 days',     (SELECT id FROM children WHERE name='Nova'),  'info', 'devices',   NULL,
  'A new tablet joined the network and has not been claimed by anybody yet.', true);

-- ---------------------------------------------------------------------------
-- DNS history, so the top sites and the per-service breakdowns have something
-- to count. Domains only: Genkan never records what was on a page.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE d_domains (domain text, category text, weight numeric, blockrate numeric);
INSERT INTO d_domains VALUES
 ('youtube.com','video',34,0.00), ('googlevideo.com','video',30,0.00), ('ytimg.com','video',14,0.00),
 ('netflix.com','video',9,0.00),  ('nflxvideo.net','video',7,0.00),    ('disneyplus.com','video',5,0.00),
 ('tiktok.com','video',6,0.02),   ('twitch.tv','video',4,0.00),
 ('roblox.com','gaming',26,0.00), ('rbxcdn.com','gaming',20,0.00),     ('minecraft.net','gaming',9,0.00),
 ('epicgames.com','gaming',6,0.00), ('steampowered.com','gaming',4,0.00),
 ('snapchat.com','social',16,0.00), ('instagram.com','social',13,0.00), ('cdninstagram.com','social',9,0.00),
 ('discord.com','social',7,0.00),
 ('spotify.com','audio',15,0.00), ('scdn.co','audio',12,0.00),
 ('khanacademy.org','schoolwork',11,0.00), ('classroom.google.com','schoolwork',9,0.00),
 ('docs.google.com','schoolwork',10,0.00), ('education.govt.nz','schoolwork',3,0.00),
 ('wikipedia.org','other',8,0.00), ('bbc.co.uk','other',4,0.00), ('rnz.co.nz','other',3,0.00),
 ('apple.com','other',6,0.00),    ('gstatic.com','other',18,0.00),    ('googleapis.com','other',16,0.00),
 ('cloudflare.com','other',5,0.00),
 -- The blocked end of the list. High block rates, low volume: that is what a
 -- filter that is working looks like.
 ('doubleclick.net','ads',9,1.00), ('googleadservices.com','ads',6,1.00),
 ('adservice.google.com','ads',5,1.00), ('scorecardresearch.com','ads',3,1.00),
 ('nordvpn.com','proxy-vpn',1,1.00), ('torproject.org','tor',1,1.00),
 ('poki.com','gaming',3,0.35), ('crazygames.com','gaming',3,0.35);

INSERT INTO dns_log (ts, device_id, client_ip, domain, category, action)
SELECT now() - (random() * interval '6 days'),
       dv.id, dv.reserved_ip, dm.domain, dm.category,
       CASE WHEN random() < dm.blockrate THEN 'blocked' ELSE 'allowed' END
FROM generate_series(1, 5200) s
CROSS JOIN LATERAL (
  SELECT id, reserved_ip FROM devices
  WHERE category='personal' AND is_active ORDER BY random() LIMIT 1
) dv
CROSS JOIN LATERAL (
  SELECT domain, category, blockrate FROM d_domains
  ORDER BY -ln(random()) / weight LIMIT 1
) dm;

-- ---------------------------------------------------------------------------
-- Bedtimes. A fourteen-year-old and a seven-year-old do not go to bed at the
-- same time, and a Friday night is not a Tuesday night, so the demo shows both
-- shapes rather than one bedtime for everybody. `days` is 0=Sunday and is the
-- night the window STARTS on, so school nights are Sunday through Thursday.
-- Nova has none on purpose: a household where only some children have a
-- bedtime is the ordinary case, and the page has to read sensibly for a child
-- whose internet nothing switches off.
INSERT INTO schedules (child_id, name, days, start_min, end_min, action, enabled, categories, set_by) VALUES
 ((SELECT id FROM children WHERE name='Piper'), 'school-night bedtime', ARRAY[0,1,2,3,4], 1290, 420, 'block', true, ARRAY['internet'], 'demo'),
 ((SELECT id FROM children WHERE name='Piper'), 'weekend bedtime',      ARRAY[5,6],       1380, 510, 'block', true, ARRAY['internet'], 'demo'),
 ((SELECT id FROM children WHERE name='Rangi'), 'school-night bedtime', ARRAY[0,1,2,3,4], 1200, 420, 'block', true, ARRAY['internet'], 'demo'),
 ((SELECT id FROM children WHERE name='Rangi'), 'weekend bedtime',      ARRAY[5,6],       1290, 480, 'block', true, ARRAY['internet'], 'demo');

-- The school holidays, coming up. Nothing has to be edited and nothing has to
-- be edited back: bedtimes simply do not run inside the dates.
INSERT INTO schedule_overrides (child_id, name, starts, ends, mode, set_by) VALUES
 (NULL, 'term break', CURRENT_DATE + 24, CURRENT_DATE + 38, 'off', 'demo');

-- Which domains define a blockable category, for the "risky lookups" count.
INSERT INTO category_domains (category, domain) VALUES
 ('proxy-vpn','nordvpn.com'), ('proxy-vpn','protonvpn.com'),
 ('tor','torproject.org'),
 ('gambling','bet365.com'), ('gambling','tab.co.nz'),
 ('ads','doubleclick.net'), ('ads','googleadservices.com')
ON CONFLICT DO NOTHING;

DROP TABLE d_days;
DROP TABLE d_domains;

COMMIT;

-- A quick sanity read, printed by demo/reseed.sh.
SELECT (SELECT count(*) FROM children)       AS people,
       (SELECT count(*) FROM devices)        AS devices,
       (SELECT count(*) FROM time_ledger)    AS ledger_days,
       (SELECT count(*) FROM category_usage) AS category_rows,
       (SELECT count(*) FROM service_usage)  AS service_rows,
       (SELECT count(*) FROM time_events)    AS earn_events,
       (SELECT count(*) FROM quiz_rounds)    AS quiz_rounds,
       (SELECT count(*) FROM dns_log)        AS dns_rows,
       (SELECT count(*) FROM schedules)      AS bedtimes;
