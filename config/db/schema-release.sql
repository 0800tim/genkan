-- Genkan: what version this household is running, and every version it has
-- ever run. Written by bin/genkan-upgrade and bin/genkan-rollback.
--
-- WHY THIS TABLE EXISTS
-- Before it, there was no way to answer "what am I running, and what was I
-- running before it broke". The git log is not that answer: it tells you what
-- the code says, not when this box last actually ran deploy.sh, and it says
-- nothing at all about the rollbacks. A household that has just had its
-- internet come back needs to be able to see, in one place, that an upgrade
-- happened at 9:14pm, that the health check failed, and that Genkan put the
-- old version back at 9:16pm.
--
-- It is deliberately an append-only log. Nothing here is ever updated: a row
-- is one thing that happened to this box. The tools treat every write as best
-- effort, so a database that is down cannot stop an upgrade or a rollback.
-- That is the right way round: the release tooling must work when the
-- database does not, because a broken database is one of the things a parent
-- would be rolling back to fix.
--
-- Load order: any time after schema.sql. Nothing else depends on it.
-- Idempotent, safe to re-run.

CREATE TABLE IF NOT EXISTS release_history (
  id           bigserial PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  -- install: a first deploy. upgrade: moved forward. rollback: went back.
  action       text NOT NULL CHECK (action IN ('install','upgrade','rollback')),
  from_version text,
  from_commit  text,
  to_version   text,
  to_commit    text,
  -- The id of the snapshot directory this change can be undone from, under
  -- /var/lib/genkan/releases. Null when nothing was snapshotted.
  snapshot     text,
  -- Did the health check pass afterwards? false means the change was
  -- automatically undone, or that somebody is looking at a broken box.
  ok           boolean NOT NULL DEFAULT true,
  note         text
);
CREATE INDEX IF NOT EXISTS release_history_ts_idx ON release_history (ts DESC);

-- What this box is running now, as far as the release tooling knows. Reads
-- the last row that actually succeeded, so a failed upgrade that rolled
-- itself back does not claim to be the current version.
CREATE OR REPLACE VIEW release_current AS
SELECT id, ts, action, to_version AS version, to_commit AS commit, snapshot, note
FROM release_history
WHERE ok
ORDER BY ts DESC
LIMIT 1;

-- The short history the dashboard and docs/UPGRADING.md point people at.
CREATE OR REPLACE VIEW release_log AS
SELECT id, ts, action, from_version, to_version, ok, note
FROM release_history
ORDER BY ts DESC
LIMIT 50;

-- The dashboard and portal connect as kids_app and only ever read this.
GRANT SELECT ON release_history TO kids_app;
GRANT SELECT ON release_current TO kids_app;
GRANT SELECT ON release_log     TO kids_app;

-- kids_agent is the role bin/ connects as, and it is created in grants.sql,
-- which runs AFTER every schema file. On a fresh load it does not exist yet,
-- so its grants live in grants.sql alongside all the others. This block is
-- for the other case: an existing household that loads only this new file
-- into a database where kids_agent already exists. Both paths are idempotent,
-- and one of them is always a no-op.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_agent') THEN
    EXECUTE 'GRANT SELECT, INSERT ON release_history TO kids_agent';
    EXECUTE 'GRANT USAGE ON SEQUENCE release_history_id_seq TO kids_agent';
    EXECUTE 'GRANT SELECT ON release_current TO kids_agent';
    EXECUTE 'GRANT SELECT ON release_log TO kids_agent';
  END IF;
END $$;
