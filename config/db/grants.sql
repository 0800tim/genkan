-- Genkan: the least-privilege role the CLI and the background workers use.
--
-- WHY THIS FILE EXISTS
-- Every kidnet command used to run as the Postgres superuser, on a Postgres
-- instance that is shared with unrelated projects. That turned any SQL
-- injection in bin/ into a whole-server compromise, because a superuser can
-- run COPY ... TO PROGRAM, which is command execution inside the database
-- container, and can read and write every other database on the box.
-- So bin/kidnet and the workers now connect as kids_agent instead.
--
-- WHAT kids_agent IS AND IS NOT
--   is:     an ordinary login role with SELECT/INSERT/UPDATE/DELETE on exactly
--           the Genkan tables the scripts touch, and nothing else.
--   is not: a superuser, an owner of anything, a member of any pg_* role, and
--           in particular not a member of pg_execute_server_program,
--           pg_read_server_files or pg_write_server_files. So COPY ... TO
--           PROGRAM and COPY ... FROM '/path' are both refused, and no DDL
--           (DROP, ALTER, TRUNCATE) is possible on any table.
-- It has no password, so the "host all all all scram-sha-256" line in
-- pg_hba.conf can never authenticate it: it is reachable only over the local
-- socket inside the postgres container, which is how docker exec reaches it.
--
-- kids_app stays exactly as it was. It is the HTTP-facing role (dashboard,
-- portal, voice) and widening it to cover the CLI's writes would have handed
-- the web surface more than it needs. Two roles, two jobs.
--
-- ADDING A VERB: if you add a kidnet verb that touches a table not listed
-- below, add its grant here as well, or the verb will fail with "permission
-- denied" as kids_agent. Grant the narrowest verb list that works.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kids_agent') THEN
    CREATE ROLE kids_agent LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO kids_agent;

-- Fence the household database off from every other role on a shared server.
-- Postgres lets PUBLIC connect to a new database by default, so on a box where
-- Genkan shares an instance with unrelated projects, any of those projects'
-- roles could open kids_network and read the catalogue. Only the two Genkan
-- roles (and a superuser, who always may) need to be in here. Written as a DO
-- block so the database can be called anything: the demo and the test harness
-- both load this schema under other names.
--
-- The mirror of this, fencing kids_agent OUT of other projects' databases, is
-- not something this file can do: that would mean editing an ACL Genkan does
-- not own. kids_agent has no rights on any table anywhere else, so the most it
-- could do is read another database's catalogue. If you want even that closed,
-- run REVOKE CONNECT ON DATABASE <theirs> FROM PUBLIC yourself, knowing it is
-- their database you are changing. See docs/OPERATIONS.md.
DO $$ BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO kids_app, kids_agent', current_database());
END $$;

-- Reference data the scripts only ever read.
GRANT SELECT ON category_domains      TO kids_agent;  -- genkan-adguard, genkan-catmap
GRANT SELECT ON flag_domains          TO kids_agent;  -- genkan-alerts, genkan-report
-- The allow list and the filter levels (config/db/schema-settings.sql). Both
-- used to be SELECT only. `genkan allow add|remove` now grows the reading
-- list and the search hosts, and `genkan tier set` edits what a level means,
-- so the Settings page has a path that is not raw SQL from the web tier.
-- DELETE on always_allow is granted knowing what it could reach: the trigger
-- always_allow_keep_safety refuses to delete or narrow a scope='safety' row
-- for every role, kids_agent included, and test/db-role-test.sh proves it.
-- No UPDATE on always_allow: a row is added or removed, never edited into a
-- different promise. No INSERT or DELETE on policies: a level is edited, never
-- invented or dropped from a command line.
GRANT SELECT, INSERT, DELETE ON always_allow TO kids_agent;  -- genkan allow add|remove
GRANT USAGE ON SEQUENCE always_allow_id_seq TO kids_agent;
GRANT SELECT, UPDATE         ON policies     TO kids_agent;  -- genkan tier set
GRANT SELECT ON services              TO kids_agent;  -- genkan-servicemap/-servicemeter
GRANT SELECT ON service_domains       TO kids_agent;
GRANT SELECT ON tasks                 TO kids_agent;  -- kidnet earn, genkan-report
GRANT SELECT ON earn_claims           TO kids_agent;  -- genkan-report
GRANT SELECT ON device_claims         TO kids_agent;  -- kidnet claims
GRANT SELECT ON vendor_clouds         TO kids_agent;  -- genkan-iot-policy
GRANT SELECT ON vendor_domains        TO kids_agent;
GRANT SELECT ON vendor_aliases        TO kids_agent;
GRANT SELECT ON quiz_banks            TO kids_agent;  -- genkan-quiz, -quiz-suggest
GRANT SELECT ON quiz_bank_questions   TO kids_agent;
GRANT SELECT ON quiz_settings         TO kids_agent;
GRANT SELECT ON quiz_rounds           TO kids_agent;
GRANT SELECT ON quiz_answers          TO kids_agent;

-- Views. A view here is owned by the schema loader, not by kids_agent, so
-- SELECT on the view is enough: the reader never needs rights on the tables
-- underneath it. That is deliberate, and it is why device_class_policy,
-- device_policy overrides and the rest are not in the list above.
GRANT SELECT ON device_roster            TO kids_agent;
GRANT SELECT ON household_roster         TO kids_agent;
GRANT SELECT ON people                   TO kids_agent;
GRANT SELECT ON people_devices           TO kids_agent;
GRANT SELECT ON time_remaining           TO kids_agent;
GRANT SELECT ON unclaimed_devices        TO kids_agent;
GRANT SELECT ON device_policy_effective  TO kids_agent;
GRANT SELECT ON device_access_pairs      TO kids_agent;
GRANT SELECT ON quiz_form                TO kids_agent;
GRANT SELECT ON quiz_difficulty_form     TO kids_agent;

-- The scope functions. They are the only way bin/kidnet turns "kids" or
-- "guests" into people and addresses, and the IoT-never-cut guard lives inside
-- them, so the CLI cannot work without EXECUTE here.
GRANT EXECUTE ON FUNCTION people_in_scope(text) TO kids_agent;
GRANT EXECUTE ON FUNCTION ips_in_scope(text)    TO kids_agent;

-- State the CLI and the timers write. Note what is NOT granted: no DELETE on
-- children, devices, dns_log, time_ledger or time_events, so a bad argument
-- cannot erase a child, a device or the history of either.
GRANT SELECT, INSERT, UPDATE         ON children      TO kids_agent;  -- person add, guest leave/back
GRANT SELECT, INSERT, UPDATE         ON devices       TO kids_agent;  -- assign, infra, confirm, devicescan, classify
GRANT SELECT, INSERT, UPDATE         ON dhcp_leases   TO kids_agent;  -- genkan-devicescan
GRANT SELECT, INSERT                 ON dns_log       TO kids_agent;  -- genkan-dnslog
GRANT SELECT, INSERT, UPDATE         ON alerts        TO kids_agent;  -- genkan-alerts, -dnslog, -iot-policy
GRANT INSERT                         ON block_events  TO kids_agent;  -- the audit trail: append only
GRANT SELECT, INSERT, UPDATE         ON time_ledger   TO kids_agent;  -- budgets, bonus, spend
GRANT SELECT, INSERT                 ON time_events   TO kids_agent;  -- earn/grant/penalty history
GRANT SELECT, INSERT, UPDATE, DELETE ON category_state    TO kids_agent;  -- DELETE: a guest going home
GRANT SELECT, INSERT, UPDATE         ON category_budgets  TO kids_agent;
GRANT SELECT, INSERT, UPDATE         ON category_usage    TO kids_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON category_ips      TO kids_agent;  -- DELETE: withdraw a shared address
GRANT SELECT, INSERT, UPDATE         ON service_ips       TO kids_agent;
GRANT SELECT, INSERT, UPDATE         ON service_usage     TO kids_agent;
GRANT SELECT, UPDATE                 ON claim_settings    TO kids_agent;  -- kidnet claim-mode
GRANT SELECT, UPDATE                 ON iot_policy_settings TO kids_agent;
-- The Tor relay list (config/db/schema-tor.sql). DELETE is granted here and
-- deliberately, unlike on children or dns_log: a relay that leaves the public
-- consensus has to leave the set too, or the household slowly accumulates a
-- block list of addresses that are no longer Tor and nobody can explain why a
-- site stopped working. genkan-tor-sync only ever deletes what the fetch it
-- just made contradicts, inside the same transaction that inserts.
GRANT SELECT, INSERT, UPDATE, DELETE ON tor_nodes       TO kids_agent;  -- genkan-tor-sync
GRANT SELECT, UPDATE                 ON tor_sync_state  TO kids_agent;  -- when, how many, and whether it worked
-- The slow lane (config/db/schema-slow.sql). One settings row the CLI updates,
-- and two read-only views. The category_state grant above already covers the
-- speed column, because the third state lives on the row the block lives on.
GRANT SELECT, UPDATE                 ON slow_settings     TO kids_agent;  -- kidnet slow-rate, slow-timeout
GRANT SELECT                         ON slow_lane_ips     TO kids_agent;
GRANT SELECT                         ON slow_lane_children TO kids_agent;
GRANT SELECT, INSERT, UPDATE         ON device_policy     TO kids_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_access_grants TO kids_agent;
GRANT SELECT, INSERT, UPDATE         ON vendor_ips        TO kids_agent;
-- The bedtime scheduler (bin/genkan-schedule) and its tables. schedule_state
-- is the "what is in force right now" row the worker rewrites every tick.
--
-- These are granted only if the relation is there. Every other grant in this
-- file is unconditional on purpose, because a missing table means a broken
-- install and should say so loudly. The scheduler is the exception: an
-- existing household upgrades its scripts before it reloads its schema, and
-- half-applied grants are worse than a scheduler that waits one deploy.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['schedules','schedule_overrides','schedule_extensions','schedule_state'] LOOP
    IF to_regclass('public.'||r) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kids_agent', r);
    ELSE RAISE NOTICE 'grants.sql: % is not loaded yet, skipping its grant', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['schedule_next','schedule_holding'] LOOP
    IF to_regclass('public.'||r) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON %I TO kids_agent', r);
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['schedules_id_seq','schedule_overrides_id_seq','schedule_extensions_id_seq'] LOOP
    IF to_regclass('public.'||r) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE ON SEQUENCE %I TO kids_agent', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='schedule_windows') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION schedule_windows(timestamptz) TO kids_agent';
  END IF;
END $$;

-- Sequences, for the tables above that the scripts INSERT into. USAGE only:
-- enough for nextval, not enough to reset a counter with setval.
GRANT USAGE ON SEQUENCE children_id_seq             TO kids_agent;
GRANT USAGE ON SEQUENCE devices_id_seq              TO kids_agent;
GRANT USAGE ON SEQUENCE dns_log_id_seq              TO kids_agent;
GRANT USAGE ON SEQUENCE alerts_id_seq               TO kids_agent;
GRANT USAGE ON SEQUENCE block_events_id_seq         TO kids_agent;
GRANT USAGE ON SEQUENCE time_events_id_seq          TO kids_agent;
GRANT USAGE ON SEQUENCE device_access_grants_id_seq TO kids_agent;

-- Shared family devices, the two sweep tick boxes, and the whole-house cut
-- (config/db/schema-shared.sql). device_state is the per-device twin of
-- category_state: `kidnet dinner` writes it for shared devices, so it needs
-- the same verbs. house_state is one row and one timestamp, and `kidnet house`
-- only ever updates it, never inserts or deletes.
GRANT SELECT, INSERT, UPDATE, DELETE ON device_state TO kids_agent;
GRANT SELECT, UPDATE                 ON house_state  TO kids_agent;
GRANT SELECT ON device_sweeps       TO kids_agent;
GRANT SELECT ON house_status        TO kids_agent;
GRANT SELECT ON blocked_device_ips  TO kids_agent;

-- Notifications (config/db/schema-notify.sql). bin/genkan-notify reads the
-- routes and the wording, writes the dedupe ledger and the log, and stamps a
-- route's last result. It may not DELETE from notify_sent: that ledger is the
-- only thing standing between a parent and the same 2am alert twice, and a
-- worker that could clear it could undo the promise. Removing a route removes
-- its ledger, and that is a parent's decision on the dashboard, not a
-- worker's. notify_pending and notify_route_state are views, so SELECT on
-- them is enough and the tables underneath stay closed.
GRANT SELECT ON notify_pending      TO kids_agent;
GRANT SELECT ON notify_route_state  TO kids_agent;
GRANT SELECT, INSERT, UPDATE, DELETE ON notify_routes TO kids_agent;  -- add/set/remove
GRANT USAGE ON SEQUENCE notify_routes_id_seq TO kids_agent;
GRANT SELECT         ON notify_wording TO kids_agent;
GRANT SELECT, INSERT ON notify_sent    TO kids_agent;  -- append only, on purpose
-- DELETE on the log only, so the worker can trim attempts older than a month.
-- Not on notify_sent: that ledger is the promise about not sending twice.
GRANT SELECT, INSERT, DELETE ON notify_log TO kids_agent;
GRANT USAGE ON SEQUENCE notify_sent_id_seq TO kids_agent;
GRANT USAGE ON SEQUENCE notify_log_id_seq  TO kids_agent;

-- The release log (config/db/schema-release.sql). bin/genkan-upgrade and
-- bin/genkan-rollback append one row per thing that happened to this box:
-- installed, upgraded, rolled back. Append only, on purpose. Nothing rewrites
-- history here, and a version that lied about what it did to the household
-- would be worse than no record at all.
GRANT SELECT, INSERT ON release_history TO kids_agent;
GRANT USAGE ON SEQUENCE release_history_id_seq TO kids_agent;
GRANT SELECT ON release_current TO kids_agent;
GRANT SELECT ON release_log     TO kids_agent;
