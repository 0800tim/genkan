-- Notifications to parents.
--
-- Genkan already knows things a parent needs to hear: a device nobody has
-- claimed, a camera that is not as restricted as the policy says, a Tor or
-- self-harm signal, a child out of time. Until this file they all sat on a
-- dashboard nobody was looking at, and a parent learned on Saturday that
-- something concerning happened on Wednesday.
--
-- THE CONSTRAINT THAT SHAPES ALL OF IT: Genkan has no telemetry and talks to
-- no cloud, and that stays true. So a notification is never "we send your
-- child's activity to a service". It is the household's own box posting a
-- message the household configured, to an address the household chose, over a
-- route the household controls. If nobody adds a route, nothing is ever sent
-- anywhere, which is the shipped default.
--
-- FOUR TABLES AND A VIEW
--   notify_routes    where to send, what to send, and when to stay quiet
--   notify_wording   the exact words that land on a phone, as data
--   notify_sent      the dedupe ledger: one row per (route, alert), ever
--   notify_log       every attempt, good and bad, with no secrets in it
--   notify_pending   what each route still owes, which is what the worker reads
--
-- bin/genkan-notify is the worker. docs/NOTIFICATIONS.md is the long version.

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------
-- kind is deliberately a short list. Two of them are built and tested:
--
--   ntfy      POST to a topic on ntfy.sh or, better, the family's own ntfy
--             server. No accounts, works on iOS and Android, and a household
--             that runs its own server never touches anybody else's.
--   webhook   POST a small JSON body to any URL. This is the escape hatch:
--             Home Assistant, Node-RED, a Matrix bridge, a script.
--
-- and two are declared but not built, so that a half-built route cannot be
-- created by accident and then quietly fail to notify anyone:
--
--   email     needs the household's own SMTP server
--   homeassistant  a first-class HA route, rather than HA behind a webhook
--
-- bin/genkan-notify refuses to create or send those two and says why. See
-- docs/NOTIFICATIONS.md, "Extension points", for where the code goes.
CREATE TABLE IF NOT EXISTS notify_routes (
  id            serial PRIMARY KEY,
  name          text NOT NULL UNIQUE,          -- 'dad-phone', short, no secrets
  kind          text NOT NULL,
  -- ntfy:    https://ntfy.sh/some-long-private-topic  (or your own server)
  -- webhook: the full URL to POST to
  -- This is a secret in the ntfy case, because the topic name IS the password.
  -- It lives here and never in a tracked file. Nothing ever logs it.
  target        text NOT NULL,
  token         text,                          -- optional bearer token. Never logged.
  -- 'info' = everything, 'warn' = warn and urgent, 'urgent' = only the urgent.
  -- The default is 'warn' on purpose: a chore waiting for approval is not a
  -- 2am push, and a route that cries wolf is a route a parent learns to ignore.
  min_severity  text NOT NULL DEFAULT 'warn',
  -- Empty means every category at or above min_severity. Non-empty narrows it.
  categories    text[] NOT NULL DEFAULT '{}',
  -- Quiet hours, minutes from midnight in the DATABASE's timezone, which
  -- deploy.sh pins to the household's (GENKAN_TZ). Both NULL means no quiet
  -- hours. The window may cross midnight: 1290 to 420 is 21:30 to 07:00.
  quiet_start_min int,
  quiet_end_min   int,
  -- Whether an urgent alert still goes through during quiet hours. Default
  -- yes. A household can turn it off, and docs/NOTIFICATIONS.md is blunt about
  -- what that means: the alert waits until morning.
  quiet_urgent  boolean NOT NULL DEFAULT true,
  -- Whether this route may carry the alert's own detail text. Default no, and
  -- it can only ever widen as far as notify_wording.detail_ok allows, so the
  -- categories marked private stay private no matter what a route asks for.
  include_detail boolean NOT NULL DEFAULT false,
  -- Rate limits, per route. A burst is already collapsed into one message by
  -- the worker; these are the backstop. Urgent has its own, larger allowance
  -- and ignores the minimum gap, because a rate limit that swallows a safety
  -- signal is worse than a phone that buzzes twice.
  max_per_hour        int NOT NULL DEFAULT 6,
  min_gap_sec         int NOT NULL DEFAULT 45,
  max_urgent_per_hour int NOT NULL DEFAULT 12,
  -- How long to leave a route alone after it failed. A dead endpoint would
  -- otherwise be re-POSTed every minute forever and fill the log with the same
  -- line. Nothing is lost by waiting: the alerts stay unacknowledged and unsent
  -- and go the moment the route answers again. Two minutes is the default, so
  -- the worst an urgent alert waits on a flapping route is two minutes.
  retry_after_fail_sec int NOT NULL DEFAULT 120,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  CONSTRAINT notify_routes_kind_ck  CHECK (kind IN ('ntfy','webhook','email','homeassistant')),
  CONSTRAINT notify_routes_sev_ck   CHECK (min_severity IN ('info','warn','urgent')),
  CONSTRAINT notify_routes_quiet_ck CHECK ((quiet_start_min IS NULL) = (quiet_end_min IS NULL)),
  CONSTRAINT notify_routes_qs_ck    CHECK (quiet_start_min IS NULL OR quiet_start_min BETWEEN 0 AND 1439),
  CONSTRAINT notify_routes_qe_ck    CHECK (quiet_end_min   IS NULL OR quiet_end_min   BETWEEN 0 AND 1439),
  CONSTRAINT notify_routes_rate_ck  CHECK (max_per_hour BETWEEN 1 AND 120
                                       AND max_urgent_per_hour BETWEEN 1 AND 120
                                       AND min_gap_sec BETWEEN 0 AND 3600
                                       AND retry_after_fail_sec BETWEEN 0 AND 86400)
);

-- ---------------------------------------------------------------------------
-- The words that land on a phone
-- ---------------------------------------------------------------------------
-- These are data, not string literals in a script, for three reasons. A
-- household can re-word them without editing code. A reviewer can read the
-- whole set in one query and check what would appear on a lock screen. And the
-- two rules that matter are enforced by columns rather than by remembering:
--
--   name_ok    may this message name a child?
--   detail_ok  may this message carry the alert's own text (which can contain
--              a domain, and therefore something about a child's browsing)?
--
-- Both are FALSE for every genuinely sensitive category. A push notification is
-- read out of context, possibly in front of other people, and possibly by
-- somebody reading over a shoulder. So the safety alerts say that something
-- needs a parent's eyes and where to look, and they say nothing else. The
-- detail is on the dashboard, at home, on the private network. That is the
-- whole design, and docs/tor-and-safety.md's tone rules are why: these alerts
-- exist to start a conversation, not to convict a child on a lock screen.
--
-- Placeholders: {n} the number of things, {who} names (only if name_ok),
-- {what} the alert's own detail (only if detail_ok AND the route asked).
CREATE TABLE IF NOT EXISTS notify_wording (
  category  text PRIMARY KEY,
  title     text NOT NULL,
  body_one  text NOT NULL,
  body_many text NOT NULL,
  name_ok   boolean NOT NULL DEFAULT false,
  detail_ok boolean NOT NULL DEFAULT false,
  priority  int NOT NULL DEFAULT 3,          -- ntfy priority, 1 quiet .. 5 max
  tags      text NOT NULL DEFAULT 'house',   -- ntfy tags, rendered as emoji
  CONSTRAINT notify_wording_pri_ck CHECK (priority BETWEEN 1 AND 5)
);

-- Three reserved rows, marked with @ so they can never collide with a real
-- alert category: the fallback for a category nobody has worded yet, the
-- summary that collapses a mixed batch, and the test message.
INSERT INTO notify_wording(category, title, body_one, body_many, name_ok, detail_ok, priority, tags) VALUES

-- The care alert. This is the one the whole design is bent around.
-- It names nobody, says nothing about what was looked up, and does not use the
-- word that would tell a stranger on the bus what happened. It says: this is
-- care, not trouble; it is on the dashboard at home; read it privately.
 ('self-harm', 'Genkan: worth a quiet check in',
  'One thing today needs your eyes, and it is a care thing, not a trouble thing. The detail is on the Genkan dashboard at home. Read it somewhere private.',
  'A few things today need your eyes, and they are care things, not trouble things. The detail is on the Genkan dashboard at home. Read it somewhere private.',
  false, false, 5, 'house'),

-- The blocked-road signals. A kid who bounces off the Tor block is not in
-- trouble (docs/tor-and-safety.md), so the message must not read as an
-- accusation. No name, no domain.
 ('tor', 'Genkan: worth a conversation tonight',
  'Someone tried to reach a part of the internet Genkan blocks. It was blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  'There were {n} attempts to reach parts of the internet Genkan blocks. They were blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  false, false, 4, 'house'),
 ('darknet', 'Genkan: worth a conversation tonight',
  'Someone tried to reach a part of the internet Genkan blocks. It was blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  'There were {n} attempts to reach parts of the internet Genkan blocks. They were blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  false, false, 4, 'house'),
 ('drugs', 'Genkan: worth a conversation tonight',
  'Someone tried to reach a site Genkan blocks. It was blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  'There were {n} attempts to reach sites Genkan blocks. They were blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  false, false, 4, 'house'),
 ('extreme', 'Genkan: worth a conversation tonight',
  'Someone tried to reach a site Genkan blocks. It was blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  'There were {n} attempts to reach sites Genkan blocks. They were blocked. Nobody is in trouble. The detail is on the dashboard at home.',
  false, false, 4, 'house'),

-- Filter bypass. Usually curiosity. Worded as a question, not a charge.
 ('proxy-vpn', 'Genkan: someone looked at a way round the filter',
  'A VPN or proxy was looked up on the kids network. Usually curiosity, occasionally a way round the filter. The detail is on the dashboard at home.',
  'VPN or proxy sites were looked up {n} times on the kids network. Usually curiosity, occasionally a way round the filter. The detail is on the dashboard at home.',
  false, false, 3, 'house'),

-- The household and housekeeping ones. These may say what they are about,
-- because none of them is about a child's private business.
 ('devices', 'Genkan: a device nobody has claimed joined the network',
  'A device nobody has claimed joined the network. It has limited access until somebody names it.',
  '{n} devices nobody has claimed joined the network. They have limited access until somebody names them.',
  false, false, 3, 'house'),
 ('iot-policy', 'Genkan: a household device is not as restricted as it should be',
  'The household device policy did not apply cleanly, so something may have more access than the rules say. The detail is on the dashboard at home.',
  'The household device policy did not apply cleanly {n} times, so something may have more access than the rules say. The detail is on the dashboard at home.',
  false, true, 4, 'house'),
 ('gateway', 'Genkan: the gateway needs a look',
  'The Genkan gateway raised something at start-up. The kids network may not be serving. The detail is on the dashboard at home.',
  'The Genkan gateway raised {n} things at start-up. The kids network may not be serving. The detail is on the dashboard at home.',
  false, true, 4, 'house'),
 ('dns-ingest', 'Genkan: Genkan has stopped recording lookups',
  'Genkan cannot read the DNS query log, so nothing is being recorded or metered right now. The detail is on the dashboard at home.',
  'Genkan cannot read the DNS query log, so nothing is being recorded or metered right now. The detail is on the dashboard at home.',
  false, true, 4, 'house'),

-- Routine. Named, because "Nova has used today''s time" is useful and is
-- nobody''s secret. Priority 2 and severity info, so on the default 'warn'
-- route these never fire at all.
 ('time', 'Genkan: out of time',
  '{who} has used today''s screen time.',
  '{n} of them have used today''s screen time: {who}.',
  true, false, 2, 'hourglass'),
 ('earn', 'Genkan: a job is waiting for your yes',
  '{who} has finished a job and is waiting on you. It can wait until morning.',
  '{n} jobs are finished and waiting on you: {who}. They can wait until morning.',
  true, false, 2, 'house'),

-- Reserved. A category nobody has worded yet says the least it can, which is
-- the safe direction to fail in: it never guesses that a new alert type is
-- harmless enough to quote on a lock screen.
 ('@fallback', 'Genkan: something needs a look',
  'Something needs your attention. The detail is on the Genkan dashboard at home.',
  '{n} things need your attention. The detail is on the Genkan dashboard at home.',
  false, false, 3, 'house'),
 ('@summary', 'Genkan: a few things need a look',
  'Something needs your attention. The detail is on the Genkan dashboard at home.',
  '{n} things need your attention. The detail is on the Genkan dashboard at home.',
  false, false, 3, 'house'),
 ('@test', 'Genkan: this is a test',
  'Notifications are working. Nothing has happened.',
  'Notifications are working. Nothing has happened.',
  false, false, 3, 'house')
ON CONFLICT (category) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The dedupe ledger
-- ---------------------------------------------------------------------------
-- One row per (route, alert), ever. The UNIQUE constraint is the whole
-- mechanism: the worker cannot send the same alert to the same route twice,
-- even if two runs overlap, because the second INSERT loses. A duplicate
-- safety alert at 2am is how a parent learns to ignore them.
--
-- Rows are written only AFTER the send succeeded. A route that is down writes
-- nothing, so the alert stays unacknowledged and unsent and goes next time. A
-- notification is never lost by failing to deliver it.
--
--   status 'sent'     it went
--   status 'stale'    it was older than the horizon when the route first saw
--                     it, so it was retired instead of sent. This is what stops
--                     a database restore, or a route added on Saturday, from
--                     firing a week of history at somebody's phone at once.
CREATE TABLE IF NOT EXISTS notify_sent (
  id        bigserial PRIMARY KEY,
  route_id  int NOT NULL REFERENCES notify_routes(id) ON DELETE CASCADE,
  alert_id  bigint NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  batch_key text,                              -- which message carried it
  status    text NOT NULL DEFAULT 'sent',
  sent_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notify_sent_uq     UNIQUE (route_id, alert_id),
  CONSTRAINT notify_sent_status_ck CHECK (status IN ('sent','stale'))
);
CREATE INDEX IF NOT EXISTS notify_sent_route_idx ON notify_sent (route_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- The log
-- ---------------------------------------------------------------------------
-- Fail silently to the parent, loudly to the log. Every attempt lands here,
-- successful or not, with the route's NAME and KIND and never its target or
-- its token. A parent reading this file, or a stranger reading a copy of the
-- database, learns that 'dad-phone' failed with a 502. Not where it points.
CREATE TABLE IF NOT EXISTS notify_log (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  route_id    int REFERENCES notify_routes(id) ON DELETE SET NULL,
  route_name  text,
  kind        text,
  ok          boolean NOT NULL,
  http_status int,
  n_alerts    int NOT NULL DEFAULT 0,
  -- Whether this message carried an urgent alert. Urgent has its own, larger
  -- hourly allowance, so the worker has to be able to count the two apart.
  urgent      boolean NOT NULL DEFAULT false,
  -- A "send a test" from the dashboard or the CLI. Marked so it never eats a
  -- real alert's allowance in the hourly rate window: proving your setup works
  -- must not be the reason the next alert is held back.
  is_test     boolean NOT NULL DEFAULT false,
  title       text,
  detail      text
);
CREATE INDEX IF NOT EXISTS notify_log_ts_idx ON notify_log (ts DESC);

-- ---------------------------------------------------------------------------
-- What each route still owes
-- ---------------------------------------------------------------------------
-- The worker reads this and nothing else to decide what to send. Putting the
-- severity and category filtering here rather than in bash means it is one
-- readable query a reviewer can run by hand:
--
--   SELECT * FROM notify_pending;
--
-- The age horizon is NOT here: the worker applies it, because it is the thing
-- that decides between sending and retiring, and this view has to show both.
CREATE OR REPLACE VIEW notify_pending AS
  SELECT r.id AS route_id, r.name AS route, r.kind,
         a.id AS alert_id, a.ts, a.severity,
         coalesce(a.category, 'other') AS category,
         c.name AS child, a.domain, a.detail
    FROM notify_routes r
    CROSS JOIN alerts a
    LEFT JOIN children c ON c.id = a.child_id
   WHERE r.enabled
     AND NOT a.acknowledged
     AND CASE r.min_severity
           WHEN 'urgent' THEN a.severity = 'urgent'
           WHEN 'warn'   THEN a.severity IN ('warn', 'urgent')
           ELSE true
         END
     AND (cardinality(r.categories) = 0
          OR coalesce(a.category, 'other') = ANY (r.categories))
     AND NOT EXISTS (SELECT 1 FROM notify_sent s
                      WHERE s.route_id = r.id AND s.alert_id = a.id);

-- Is a route inside its quiet hours right now? In SQL rather than in bash
-- because now() here is the DATABASE's clock, which deploy.sh pins to the
-- household's timezone. The box itself may well be running UTC, and a quiet
-- hours window that is twelve hours out is worse than none.
CREATE OR REPLACE VIEW notify_route_state AS
  SELECT r.*,
         CASE
           WHEN r.quiet_start_min IS NULL THEN false
           WHEN r.quiet_start_min < r.quiet_end_min THEN
             m.now_min >= r.quiet_start_min AND m.now_min < r.quiet_end_min
           WHEN r.quiet_start_min > r.quiet_end_min THEN
             m.now_min >= r.quiet_start_min OR m.now_min < r.quiet_end_min
           ELSE false            -- start = end is an empty window, not all day
         END AS in_quiet,
         (SELECT count(*) FROM notify_log l
           WHERE l.route_id = r.id AND l.ok AND NOT l.is_test
             AND l.ts > now() - interval '1 hour') AS sent_last_hour,
         (SELECT count(*) FROM notify_log l
           WHERE l.route_id = r.id AND l.ok AND l.urgent AND NOT l.is_test
             AND l.ts > now() - interval '1 hour') AS urgent_last_hour,
         (SELECT max(l.ts) FROM notify_log l
           WHERE l.route_id = r.id AND l.ok AND NOT l.is_test) AS last_sent_at,
         -- Is the route out of its post-failure cool-off? True when it has
         -- never failed, when its last attempt succeeded, or when enough time
         -- has passed since the failure.
         (r.last_error_at IS NULL
          OR (r.last_ok_at IS NOT NULL AND r.last_ok_at >= r.last_error_at)
          OR r.last_error_at < now() - (r.retry_after_fail_sec || ' seconds')::interval)
           AS retry_ok
    FROM notify_routes r
    CROSS JOIN LATERAL (SELECT (extract(hour FROM now()) * 60
                              + extract(minute FROM now()))::int AS now_min) m;

-- The dashboard writes routes as kids_app: adding a phone is a parent's
-- decision and belongs on the page. It may read the ledger and the log so the
-- page can say when a route last worked and what it said when it did not.
-- notify_sent stays read-only to the web surface: a dashboard that could
-- delete from it could make Genkan send the same 2am alert again.
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_routes TO kids_app;
GRANT USAGE ON SEQUENCE notify_routes_id_seq TO kids_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_wording TO kids_app;
GRANT SELECT ON notify_sent, notify_log, notify_pending, notify_route_state TO kids_app;
