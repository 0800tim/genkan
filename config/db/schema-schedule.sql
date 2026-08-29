-- Scheduled bedtimes.
--
-- The `schedules` table has been in schema.sql since the first night and
-- nothing ever read it, so every bedtime in this house was a parent typing
-- `kidnet off kids` at 9pm and remembering to type `kidnet on kids` at 7am.
-- The remembering was the part that failed. This file gives that table the
-- few columns it was missing, adds the three things a real household needs
-- around it (a holiday window, tonight's extension, and a memory of what the
-- worker last did), and `bin/kidnet-schedule` reads the lot every minute.
--
-- THE ONE RULE TO KNOW: a schedule owns only the blocks it applied itself,
-- which are the ones marked set_by='bedtime'. It never lifts anybody else's.
-- The whole precedence table is in DECISIONS.md; the short version is:
--
--   a parent's block          set_by='agent'        a schedule never lifts it
--   out of time               set_by='out-of-time'  a schedule never lifts it
--   a category over budget    set_by='over-budget'  a schedule never lifts it
--   a scheduled bedtime       set_by='bedtime'      ONLY the schedule lifts it
--   a schedule lifted it      set_by='schedule-lifted'
--
-- and a parent turning the internet back on during a bedtime is remembered
-- (schedule_state.released_key) so the worker does not stamp it back a minute
-- later. That release lasts until the next window, not one minute and not
-- forever.

-- ---------------------------------------------------------------------------
-- The window itself
-- ---------------------------------------------------------------------------
-- days is 0=Sunday .. 6=Saturday, and it is the day the window STARTS on.
-- That is what makes "Friday night" mean Friday night: a bedtime of 21:00 to
-- 07:00 on days {5} runs from Friday evening into Saturday morning, and a
-- school-night bedtime on days {0,1,2,3,4} is a separate row with its own
-- times. Two rows per child is the normal shape.
--
-- end_min <= start_min means the window crosses midnight, which every bedtime
-- does. There is no separate flag for that: 21:00 to 07:00 is unambiguous.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS categories text[];

-- Rows that already existed were written when nothing read this table, so
-- nobody who wrote one expected it to switch a child's internet off. Adopting
-- them silently would do exactly that on the first run after an upgrade.
-- Disable them once, here, as they are adopted. This UPDATE can only ever
-- match rows that predate the column, so re-running this file is a no-op.
UPDATE schedules SET categories = ARRAY['internet']::text[], enabled = false
 WHERE categories IS NULL;

ALTER TABLE schedules ALTER COLUMN categories SET DEFAULT ARRAY['internet']::text[];
ALTER TABLE schedules ALTER COLUMN categories SET NOT NULL;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS updated_ts timestamptz NOT NULL DEFAULT now();
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS set_by text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedules_minutes_ck') THEN
    ALTER TABLE schedules ADD CONSTRAINT schedules_minutes_ck
      CHECK (start_min >= 0 AND start_min < 1440 AND end_min >= 0 AND end_min <= 1440);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedules_days_ck') THEN
    -- An empty day list is a schedule that can never fire, which is a typo
    -- rather than an intention. A day outside 0..6 is always a bug.
    ALTER TABLE schedules ADD CONSTRAINT schedules_days_ck
      CHECK (array_length(days,1) BETWEEN 1 AND 7
             AND days <@ ARRAY[0,1,2,3,4,5,6]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedules_action_ck') THEN
    ALTER TABLE schedules ADD CONSTRAINT schedules_action_ck
      CHECK (action IN ('block','allow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedules_cats_ck') THEN
    ALTER TABLE schedules ADD CONSTRAINT schedules_cats_ck
      CHECK (array_length(categories,1) BETWEEN 1 AND 8);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS schedules_child_idx ON schedules (child_id) WHERE enabled;

-- ---------------------------------------------------------------------------
-- Holidays and other override windows
-- ---------------------------------------------------------------------------
-- School holidays should not mean editing six schedules and then editing them
-- all back. A date range says what happens to every schedule inside it:
--
--   mode='off'   no scheduled bedtime at all on those days
--   mode='late'  every bedtime in range starts shift_min minutes later
--
-- child_id NULL means the whole household. A row naming one child beats a
-- household-wide row for that child, so "holidays, but the eleven-year-old
-- still goes off at nine" is two rows.
--
-- 'late' moves the START only. The morning restore stays where it is, because
-- the failure that matters is a child locked out longer than intended, and
-- moving the far end of the window is the only way to cause it.
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id        serial PRIMARY KEY,
  child_id  int REFERENCES children(id) ON DELETE CASCADE,   -- NULL = everybody
  name      text NOT NULL,
  starts    date NOT NULL,
  ends      date NOT NULL,                                   -- inclusive
  mode      text NOT NULL DEFAULT 'off',                     -- off | late
  shift_min int NOT NULL DEFAULT 0,
  enabled   boolean NOT NULL DEFAULT true,
  set_by    text,
  created_ts timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='schedule_overrides_ck') THEN
    ALTER TABLE schedule_overrides ADD CONSTRAINT schedule_overrides_ck
      CHECK (mode IN ('off','late') AND ends >= starts
             AND shift_min >= 0 AND shift_min <= 600);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS schedule_overrides_range_idx
  ON schedule_overrides (starts, ends) WHERE enabled;

-- ---------------------------------------------------------------------------
-- Tonight's extension
-- ---------------------------------------------------------------------------
-- "You can stay on until half past ten tonight" without touching the schedule
-- and without having to remember to put it back. An extension is one absolute
-- moment. It only affects a window it actually falls inside, so it expires by
-- arithmetic rather than by anything having to clean it up, and tomorrow's
-- bedtime is untouched.
CREATE TABLE IF NOT EXISTS schedule_extensions (
  id          bigserial PRIMARY KEY,
  child_id    int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  schedule_id int REFERENCES schedules(id) ON DELETE CASCADE,   -- NULL = whichever window it lands in
  until_ts    timestamptz NOT NULL,
  minutes     int,
  reason      text,
  granted_by  text,
  granted_ts  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_extensions_child_idx
  ON schedule_extensions (child_id, until_ts DESC);

-- ---------------------------------------------------------------------------
-- What the worker last did
-- ---------------------------------------------------------------------------
-- This table exists for exactly one reason: to tell "the worker has not
-- asserted this window yet" apart from "the worker asserted it and a parent
-- has since turned it back on". Without it those two look identical, and the
-- worker would either stamp a parent's override back a minute later or never
-- assert a bedtime at all.
--
-- window_key is schedule id plus the DATE THE WINDOW STARTED, so it changes at
-- every boundary and a release cannot leak into tomorrow night.
--
-- Empty means no memory, and no memory means assert. That is deliberate: a box
-- restored from a backup, or a fresh state table, must fail towards the
-- bedtime being in force rather than towards the child being online.
CREATE TABLE IF NOT EXISTS schedule_state (
  child_id     int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  schedule_id  int NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  category     text NOT NULL,
  window_key   text,          -- the window the worker has taken responsibility for
  asserted_ts  timestamptz,
  released_key text,          -- a window a parent lifted by hand: do not re-assert it
  released_ts  timestamptz,
  last_run     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, schedule_id, category)
);

-- ---------------------------------------------------------------------------
-- The time maths, in one place
-- ---------------------------------------------------------------------------
-- Every window this household has, expanded around a given moment, with the
-- holiday override and tonight's extension already applied. The worker, the
-- dashboard and the kid portal all read this, so none of them can disagree
-- about when the internet goes off tonight.
--
-- It takes the moment as an argument rather than reading the clock, which is
-- what makes test/schedule-test.sh able to prove a Tuesday, a Friday and a
-- Saturday morning without waiting for any of them to happen.
--
-- All of it runs in the database's own timezone (deploy.sh pins that to the
-- household's), because that is the same clock the daily budget rolls over on.
CREATE OR REPLACE FUNCTION schedule_windows(p_at timestamptz DEFAULT now())
RETURNS TABLE (
  child_id     int,
  schedule_id  int,
  name         text,
  action       text,
  categories   text[],
  starts_at    timestamptz,   -- when the block begins, extension included
  base_start   timestamptz,   -- where it would have begun with no extension
  ends_at      timestamptz,   -- when it lifts
  in_window    boolean,
  window_key   text,
  override     text,          -- the holiday row in force for this night, if any
  extended     boolean
)
LANGUAGE sql STABLE AS $$
  WITH cal AS (
    -- Yesterday as well as today, because a window that started last night is
    -- still the window that has to lift this morning.
    SELECT d::date AS d
      FROM generate_series((p_at::date - 1)::timestamp,
                           (p_at::date + 7)::timestamp, interval '1 day') g(d)
  ),
  cand AS (
    SELECT s.child_id, s.id AS schedule_id, s.name, s.action, s.categories,
           s.start_min, s.end_min, c.d,
           ov.name AS ov_name, ov.mode AS ov_mode,
           COALESCE(CASE WHEN ov.mode = 'late' THEN ov.shift_min END, 0) AS shift
      FROM schedules s
      -- A guest who has gone home keeps their row (so bringing them back next
      -- weekend is one command) but must not keep their bedtime. `kidnet guest
      -- leave` clears their blocks; without this the worker would put one
      -- straight back on somebody who is not in the house.
      JOIN children ch ON ch.id = s.child_id AND ch.active
      JOIN cal c ON EXTRACT(DOW FROM c.d)::int = ANY (s.days)
      LEFT JOIN LATERAL (
        SELECT o.name, o.mode, o.shift_min
          FROM schedule_overrides o
         WHERE o.enabled AND c.d BETWEEN o.starts AND o.ends
           AND (o.child_id IS NULL OR o.child_id = s.child_id)
         -- A row naming this child beats a household-wide one.
         ORDER BY (o.child_id IS NULL), o.id
         LIMIT 1
      ) ov ON true
     WHERE s.enabled
  ),
  win AS (
    SELECT c.*, w.st AS base_st, w.en
      FROM cand c
      CROSS JOIN LATERAL (
        SELECT (c.d::timestamp + make_interval(mins => c.start_min + c.shift))::timestamptz AS st,
               (c.d::timestamp + make_interval(mins => c.end_min
                  + CASE WHEN c.end_min <= c.start_min THEN 1440 ELSE 0 END))::timestamptz AS en
      ) w
     -- A holiday with mode='off' removes the night entirely. A 'late' shift big
     -- enough to swallow the whole window does the same thing, which is the
     -- right reading of "push bedtime back four hours" on a two hour window.
     WHERE COALESCE(c.ov_mode,'') <> 'off' AND w.st < w.en
  )
  SELECT w.child_id, w.schedule_id, w.name, w.action, w.categories,
         COALESCE(GREATEST(w.base_st, ext.u), w.base_st) AS starts_at,
         w.base_st,
         w.en,
         p_at >= COALESCE(GREATEST(w.base_st, ext.u), w.base_st) AND p_at < w.en,
         w.schedule_id || ':' || to_char(w.d, 'YYYY-MM-DD'),
         w.ov_name,
         ext.u IS NOT NULL
    FROM win w
    LEFT JOIN LATERAL (
      SELECT max(x.until_ts) AS u
        FROM schedule_extensions x
       WHERE x.child_id = w.child_id
         AND (x.schedule_id IS NULL OR x.schedule_id = w.schedule_id)
         AND x.until_ts > w.base_st AND x.until_ts < w.en
    ) ext ON true
   ORDER BY w.child_id, w.base_st;
$$;

-- One line per child for the two places that have to SAY it: the parent
-- dashboard and the kid portal. If a bedtime is running now, that is the row.
-- Otherwise it is the next one due. A child with no schedule is simply absent.
CREATE OR REPLACE VIEW schedule_next AS
  SELECT DISTINCT ON (w.child_id)
         w.child_id, c.name AS child, w.schedule_id, w.name, w.categories,
         w.starts_at, w.ends_at, w.in_window, w.window_key, w.override, w.extended
    FROM schedule_windows() w
    JOIN children c ON c.id = w.child_id
   WHERE w.ends_at > now() AND w.action = 'block'
   ORDER BY w.child_id, w.in_window DESC, w.starts_at;

-- What is off right now BECAUSE of a schedule, as opposed to off because a
-- parent said so or because the clock ran out. The dashboard uses it to label
-- a block honestly.
CREATE OR REPLACE VIEW schedule_holding AS
  SELECT cs.child_id, c.name AS child, cs.category, cs.since, n.ends_at
    FROM category_state cs
    JOIN children c ON c.id = cs.child_id
    LEFT JOIN schedule_next n ON n.child_id = cs.child_id AND n.in_window
   WHERE cs.blocked AND cs.set_by = 'bedtime';

-- The dashboard writes a schedule, a holiday and an extension as the limited
-- kids_app role, the same way it writes a goal or a category budget. Setting a
-- bedtime is a parent's decision and belongs on the page, not only in a shell.
-- schedule_state is the WORKER's memory: read-only here, because a dashboard
-- that could edit it could hand a child the night back by accident.
GRANT SELECT, INSERT, UPDATE, DELETE ON schedules, schedule_overrides, schedule_extensions TO kids_app;
GRANT USAGE ON SEQUENCE schedules_id_seq, schedule_overrides_id_seq, schedule_extensions_id_seq TO kids_app;
GRANT SELECT ON schedule_state, schedule_next, schedule_holding TO kids_app;
