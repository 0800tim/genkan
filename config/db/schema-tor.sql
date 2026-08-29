-- Tor relay addresses, so the firewall can be a projection of the database
-- like everything else it enforces.
--
-- This table exists because the layer above it was never actually switched on.
-- kidnet-tor-sync fetched the public relay list every day, wrote it to a file
-- and rendered an `nft -f` snippet, and then nothing applied the snippet. The
-- set in the running firewall stayed empty for the life of the box, the rules
-- that reject a relay matched nothing, and kidnet-health reported "the Tor
-- relay list is current" because it was reading the age of the file rather
-- than asking the firewall what it held. Three parts, each correct, and no
-- part responsible for the join.
--
-- Putting the addresses in Postgres removes the join. The gateway already
-- rebuilds its sets from this database on a timer and after every restart, so
-- a relay list that lands here is in force within the hour and stays in force
-- across a reboot, a replug and an image rebuild, with nothing to remember.
--
-- See DECISIONS.md, "The firewall is a projection of the database".

CREATE TABLE IF NOT EXISTS tor_nodes (
  ip        inet PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE tor_nodes IS
  'Public Tor relay addresses, refreshed daily by kidnet-tor-sync. The gateway reconciles the @tor_nodes nft set from this table hourly.';
COMMENT ON COLUMN tor_nodes.last_seen IS
  'When this address was last in the published relay list. A relay that leaves the list is deleted, not kept: a stale block is a household reaching for a service that is no longer Tor.';

CREATE INDEX IF NOT EXISTS tor_nodes_last_seen_idx ON tor_nodes (last_seen);

-- When the list was last fetched and how it went. One row, so the dashboard
-- and kidnet-health can say "the list is current AND in force" rather than
-- either half on its own.
CREATE TABLE IF NOT EXISTS tor_sync_state (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fetched_at timestamptz,
  node_count int NOT NULL DEFAULT 0,
  ok         boolean NOT NULL DEFAULT false,
  detail     text
);
INSERT INTO tor_sync_state(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE tor_sync_state IS
  'The last fetch of the public relay list: when, how many, and whether it worked. A fetch that fails leaves the previous addresses in place and says so here.';

GRANT SELECT ON tor_nodes, tor_sync_state TO kids_app;
