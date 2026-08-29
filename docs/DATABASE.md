# The Hearth database

Hearth keeps its state in Postgres: people, devices, category blocks, the time
ledger, per-category and per-service usage, DNS history, quiz and chore
credits, alerts, and the audit log of every on and off.

On the reference box this is a shared Postgres container. On a fresh family
gateway you provision one yourself: **`compose.yaml` does not include a Postgres
service.** It joins an existing external Docker network called `postgres` and
expects a container called `postgres` on it. The four commands to create one are
in [setup/README.md](setup/README.md).

## Creating it

    # The role the portal, dashboard and voice module connect as.
    docker exec -i postgres psql -U postgres -c \
      "CREATE ROLE kids_app LOGIN PASSWORD 'pick-something-long'"
    docker exec -i postgres psql -U postgres -c "CREATE DATABASE kids_network"

The role must exist **before** the schema files run, because several of them end
with `GRANT ... TO kids_app` and will fail otherwise.

## Schema load order

The files are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER
TABLE ... ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), so re-running
the whole set is safe. The order matters though: later files reference and
redefine things earlier ones create.

| # | File | What it adds |
|---|---|---|
| 1 | `schema.sql` | children, policies, devices, schedules, dhcp_leases, dns_log, alerts, block_events, always_allow |
| 2 | `schema-categories.sql` | category_state, category_domains, category_ips, category_usage, category_budgets |
| 3 | `schema-time.sql` | time_ledger, time_events, tasks, the time_remaining view |
| 4 | `schema-safety.sql` | the always_allow scope split: safety versus category |
| 5 | `schema-earn.sql` | earn_claims, for parent-approved chores |
| 6 | `schema-people.sql` | children.kind, device hostnames, the people and device_roster views |
| 7 | `schema-devices.sql` | devices.category and vendor, and device_roster rebuilt to carry them |
| 8 | `schema-flags.sql` | flag_domains: the Tor, darknet, self-harm and VPN alert patterns |
| 9 | `schema-services.sql` | services, service_domains, service_ips, service_usage, and the seed service list |
| 10 | `schema-voice.sql` | voice_events and the voice_recent view, for the optional voice module |
| 11 | `schema-goals.sql` | goals: one agreed weekly target per child, read by the dashboard's Week and kid pages |
| 12 | `seed.sql` | the three policy tiers, placeholder children, and the always_allow rows |

Two ordering constraints are load-bearing:

- `schema-devices.sql` must come **after** `schema-people.sql`. Both define the
  `device_roster` view; the later one adds `category` and `vendor`, and running
  them the other way around silently gives you a roster with no device class,
  which is what the dashboard and `kidnet devices` read.
- `seed.sql` must come **after** `schema-safety.sql`, because its `always_allow`
  rows set the `category` column that file adds.

Load them:

```sh
for f in schema schema-categories schema-time schema-safety schema-earn \
         schema-people schema-devices schema-flags schema-services \
         schema-voice schema-goals seed; do
  psql "$KIDS_DB_URL" -v ON_ERROR_STOP=1 -f config/db/$f.sql
done
```

`schema-voice.sql` is only needed if you run the optional voice module
(`voice/`). It is harmless to load either way, and the table it creates is the
audit trail that makes voice grants safe, so loading it costs nothing.

## One thing the seed does not do

There is no seed for the `tasks` table, so a fresh install has an empty list of
earnable chores. The portal's chore buttons and `kidnet earn <kid> <task>` both
read it, so add your own household's list:

```sql
INSERT INTO tasks (name, minutes, needs_approval) VALUES
  ('Dishes done', 30, true),
  ('Room tidy', 20, true),
  ('Homework finished', 45, true),
  ('20 min reading', 20, true),
  ('Study quiz (unrot)', 15, false);
```

`needs_approval` is the difference between the two earning paths: quizzes are
graded by the portal and credited immediately, chores are a claim a parent
approves on the dashboard or with `kidnet earn`. Both land in the same
`time_events` audit trail.

## One table nothing reads

`schedules` (child, days, start and end minute, block or allow) is defined in
`schema.sql` and read by nothing. Bedtimes are not automatic yet: today they
are `kidnet off` from a timer you write yourself, or a word to the agent. The
table is left in place because the design is settled and the column shape is
right; it is listed here so nobody assumes a row in it does something.

## Roles

The portal, the dashboard and the voice module connect as `kids_app`, which
holds only the SELECT, INSERT and UPDATE it needs on the app tables. It has no
rights over enforcement: the only audited path to the firewall is `bin/kidnet`.

`bin/kidnet` and the timer-driven tools currently connect as the Postgres
superuser, through `docker exec -i postgres psql -U postgres`. Narrowing them to
a role with exactly their grants is a known follow-up, not a done thing.

## The two connection strings

- `KIDS_DB_URL`: how **host** processes reach Postgres, via the published
  loopback port. Used by the dashboard and, where a tool reads it at all, the
  host-side kidnet tools.
- `KIDS_DB_URL_DOCKER`: the same database as a **container** sees it, via the
  Postgres network alias. Used by the portal and the gateway. Which one is
  picked is decided by the `IN_CONTAINER` flag compose sets.

Both live in the gitignored `secrets.env`.

## The day boundary

Daily budgets reset at midnight in the **database's** timezone, and the Postgres
container runs UTC by default. Without pinning it, a New Zealand family's screen
time rolls over at noon. `deploy.sh` sets it from `HEARTH_TZ` in `config.env`:

    ALTER DATABASE kids_network SET timezone = 'Pacific/Auckland';

Every date in `time_ledger`, `category_usage` and `service_usage` follows that
clock, and the dashboard's charts use the same definition so they always agree
with each other.

## What is in here, and what is deliberately not

In: domain names looked up, per device and per child. Bytes and minutes per
category and per service. Time granted, earned, spent and docked, with a reason
and who did it. Alerts and the block audit trail.

Not in: page contents, search terms, messages, or anything from inside an
encrypted app. The network cannot see them, and this schema has nowhere to put
them if it could. No audio is stored by the voice module either, only the
transcript.

Backup and restore commands are in [OPERATIONS.md](OPERATIONS.md).
