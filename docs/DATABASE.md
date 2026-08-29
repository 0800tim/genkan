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

Each file is additive and idempotent on its own (`CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), so
re-running any one of them is safe. The **whole set** is not re-runnable over a
database that already has it: `schema-people.sql` does `CREATE OR REPLACE VIEW
people`, and `schema-roles.sql` has since widened that view, so the second pass
fails with "cannot drop columns from view". A household box loads them once and
never meets it. `demo/reseed.sh` reloads nightly, so it drops the schema first.

The order matters too: later files reference and redefine things earlier ones
create.

| # | File | What it adds |
|---|---|---|
| 1 | `schema.sql` | children, policies, devices, schedules, dhcp_leases, dns_log, alerts, block_events, always_allow |
| 2 | `schema-categories.sql` | category_state, category_domains, category_ips, category_usage, category_budgets, and the seeded domain map (about 175 domains across gaming, video, download, social, audio, messaging and schoolwork) |
| 3 | `schema-time.sql` | time_ledger, time_events, tasks, the time_remaining view |
| 4 | `schema-safety.sql` | the `always_allow` scope split: `safety` versus `category`, and later the `learn` scope uses the same column |
| 5 | `schema-earn.sql` | earn_claims, for parent-approved chores |
| 6 | `schema-people.sql` | children.kind, device hostnames, the people and device_roster views |
| 7 | `schema-devices.sql` | devices.category and vendor, and device_roster rebuilt to carry them |
| 8 | `schema-flags.sql` | flag_domains: the Tor, darknet, self-harm and VPN alert patterns |
| 9 | `schema-services.sql` | services, service_domains, service_ips, service_usage, and the seeded service list: 30 services over 103 domains, CDN names included |
| 10 | `schema-voice.sql` | voice_events and the voice_recent view, for the optional voice module |
| 11 | `schema-goals.sql` | goals: one agreed weekly target per child, read by the dashboard's Week and kid pages |
| 12 | `schema-policies.sql` | the household security layer: vendor clouds and their domains, per-class and per-device IoT policy, parent grants, and the `device_policy_effective` view |
| 13 | `schema-tasks.sql` | per-child job offers and quiz bank settings: `task_offers`, `quiz_settings`, two more columns on `tasks`, and the `task_offer_effective` view the dashboard's Learn to earn screen and the portal both read |
| 14 | `schema-quizresults.sql` | `quiz_rounds` and `quiz_answers`, every graded quiz round including the failed ones, plus the `quiz_form` and `quiz_difficulty_form` views the portal's difficulty ramp reads |
| 15 | `schema-quizbanks.sql` | `quiz_banks` and `quiz_bank_questions`, the banks a parent writes on the dashboard rather than as a file in `portal/quizzes`, plus `earn_settings` and the `earn_settings_effective` view: the cooldown, the daily cap, the perfect-round bonus and the fallback price of a pass, per household and per child |
| 16 | `schema-badges.sql` | `child_badges`, `quiz_study_visits` and `board_settings`: the badges a child has earned, the log of study-page visits some badges read, and the one switch for the household board. The board is **off by default** |
| 17 | `seed.sql` | the three policy tiers, placeholder children, and the always_allow rows |
| 18 | `schema-presence.sql` | `devices.present_at`: "on the wire right now", as distinct from `last_seen`, which comes from the lease list and outlives the device |
| 19 | `schema-appliance.sql` | a fourth device class, `appliance`: not a person's and not smart-home kit, so full internet, no owner, no time limits, never caught by a kids control |
| 20 | `schema-roles.sql` | the four household roles (child, guest-child, guest-adult, adult), the `people` view with the role flags, the `people_in_scope()` and `ips_in_scope()` scope functions, and `household_roster` |
| 21 | `schema-claim.sql` | device claiming: `claim_settings`, `device_claims`, `children.claim_pin`, `devices.claim_pending` and the `unclaimed_devices` view the gateway reconciles `kids_unclaimed` from. **Off by default** (`mode='off'`) |
| 22 | `schema-learn.sql` | the reading list, part one: fifteen `always_allow` rows with `scope='learn'`, reachable through a total cut so a child out of time can go and read |
| 23 | `schema-learn-intl.sql` | the reading list, part two: the New Zealand, Australian, UK and US curriculum bodies, libraries, museums and science agencies. About forty `learn` domains between the two files |

These ordering constraints are load-bearing:

- `schema-devices.sql` must come **after** `schema-people.sql`. Both define the
  `device_roster` view; the later one adds `category` and `vendor`, and running
  them the other way around silently gives you a roster with no device class,
  which is what the dashboard and `kidnet devices` read.
- `seed.sql` must come **after** `schema-safety.sql`, because its `always_allow`
  rows set the `category` column that file adds.
- `schema-policies.sql` must come **after** `schema-devices.sql`, because its
  `device_policy_effective` view reads `devices.category` and `devices.vendor`.
- `schema-quizresults.sql` must come **after** `schema.sql`, because its two
  tables hang off `children`. Nothing else depends on it: the portal treats
  every write to it as best effort, so a gateway that has not loaded it still
  runs quizzes and still pays out minutes, just without the difficulty ramp.
- `schema-tasks.sql` must come **after** `schema-time.sql`, because it adds columns
  to `tasks`, and after `schema-people.sql`, because every offer is per child.
- `schema-quizbanks.sql` must come **after** `schema.sql`, because `earn_settings`
  hangs off `children`. Like the results file, it is optional in the sense that
  the portal degrades rather than fails without it: no database banks appear,
  and the earn numbers fall back to the constants the portal has always
  shipped. Its `quiz_bank_summary` view is dropped and recreated rather than
  replaced, so adding a column to `quiz_banks` later does not break a re-run.
- `schema-presence.sql` and `schema-appliance.sql` must come **after**
  `schema-devices.sql`, because both alter the `devices` table that file
  finishes shaping. Neither touches a view, so they sit safely between the seed
  and the roles file.
- `schema-badges.sql` must come **after** `schema.sql`, because every row in it
  hangs off `children`. Nothing depends on it in turn: `dashboard/badges.mjs`
  treats every read and write here as best effort, so a box that has not loaded
  it still runs quizzes and still pays out minutes, it just awards no badges and
  shows no board.
- `schema-roles.sql` must come **after** `schema-people.sql` and after
  `seed.sql`. It rebuilds the `people` view that `schema-people.sql` created,
  adds the `adult` filter level to the `policies` table that `seed.sql` fills,
  and migrates any old `kind='guest'` row to `guest-child`. See
  [HOUSEHOLD-ROLES.md](HOUSEHOLD-ROLES.md).
- `schema-claim.sql` must come **after** `schema-devices.sql` and
  `schema-people.sql`, because it adds a column to each of `devices` and
  `children` and its `unclaimed_devices` view reads `devices.category`. It is
  inert until somebody changes `claim_settings.mode`, so loading it on a
  household that does not want claiming changes nothing at all. See
  [DEVICE-IDENTITY.md](DEVICE-IDENTITY.md).
- `schema-learn.sql` and `schema-learn-intl.sql` must come **after**
  `schema-safety.sql`, because both insert `always_allow` rows carrying the
  `scope` and `category` columns that file adds. They go last of all simply
  because they are pure content and nothing reads them at load time. Their rows
  reach the firewall through `kidnet allow-sync` and the gateway's hourly
  refresh, not through the loader. See [READING-LIST.md](READING-LIST.md).

Load them:

```sh
config/db/load.sh kids_network            # or: config/db/load.sh <db> <postgres-container>
```

`config/db/load.sh` holds that order as an array and is the copy that actually
runs. It creates the `kids_app` role if it is missing, loads each file in turn,
prints one line per file and fails loudly on the first error. `test/schema-test.sh`
proves it against an empty database.

**The table above is documentation, the script is the contract.** If they ever
disagree, the script is right and the table is the bug. That is not a style
preference: this table was wrong for months and a fresh install failed on the
first two files with "relation children does not exist", which is why the order
was moved into something that runs.

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
