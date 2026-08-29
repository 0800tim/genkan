# The Hearth database

Hearth keeps its state (children, devices, category blocks, the time ledger,
quiz results, alerts, the audit log) in Postgres. On the reference box this is
a shared postgres container; on a fresh family gateway, compose provisions a
dedicated one.

## Schema load order (matters: later files reference earlier tables)

    config/db/schema.sql            children, policies, devices, dns_log, alerts, always_allow, ...
    config/db/schema-categories.sql per-child category blocks + category_domains
    config/db/schema-time.sql       time_ledger, time_events, tasks, time_remaining view
    config/db/schema-safety.sql     always_allow scope split (safety vs category)
    config/db/schema-earn.sql       earn_claims (+ kids_app grants)
    config/db/schema-people.sql     people (children.kind), device ownership, roster view
    config/db/seed.sql              tiers, placeholder kids, help lines, tasks

Load them with:

    for f in schema schema-categories schema-time schema-safety schema-earn seed; do
      psql "$KIDS_DB_URL" -v ON_ERROR_STOP=1 -f config/db/$f.sql
    done

## Roles

The portal and dashboard connect as a limited `kids_app` role (SELECT/INSERT/
UPDATE on the app tables), never the superuser. `bin/kidnet` currently uses
the postgres superuser for admin actions; a follow-up narrows it to a role
with only the grants it needs.

## The two connection strings

- `KIDS_DB_URL`: how HOST tools reach Postgres (the published localhost port).
  Used by kidnet, kidnet-meter, and the dashboard.
- `KIDS_DB_URL_DOCKER`: the same database as seen from inside a container (the
  postgres network alias). Used by the portal and the gateway, selected by the
  `IN_CONTAINER` flag compose sets.

Both live in the gitignored secrets.env. A fresh install generates them.
