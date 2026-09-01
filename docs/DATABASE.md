# The Genkan database

Genkan keeps its state in Postgres: people, devices, category blocks, the time
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

The second role, `kids_agent`, is created for you: `config/db/grants.sql` makes
it and is the last thing `config/db/load.sh` runs. See [Roles](#roles).

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
| 1 | `schema.sql` | children, policies, devices, schedules, dhcp_leases, dns_log, alerts, block_events, always_allow. Since 2026-09-02 `dns_log` also carries `reason` (AdGuard's own word for what it did: `FilteredBlackList`, `FilteredBlockedService`, `FilteredSafeSearch`, `RewriteRule`, `NotFilteredWhiteList`, `NotFilteredNotFound`) and `filter_list` (the name of the blocklist that matched, as AdGuard names it, or `service:<name>` for a blocked service, or `Genkan rules`), both nullable and both added with `ADD COLUMN IF NOT EXISTS`, plus indexes on `(domain, ts)` and `(action, ts)` for the log page. Rows ingested before the columns existed have null in both, and the dashboard's Analytics page shows them as "reason not recorded" rather than guessing |
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
| 16 | `schema-packages.sql` | `quiz_packages` and the `quiz_package_summary` view: the manifest of a community learning package (author, licence, who it is for, an optional read-first page), plus `install_quiz_package()` and `remove_quiz_package()`, the two `SECURITY DEFINER` functions that are the only way a package gets in or out. The bank half of a package goes into `quiz_banks` like any other |
| 17 | `schema-badges.sql` | `child_badges`, `quiz_study_visits` and `board_settings`: the badges a child has earned, the log of study-page visits some badges read, and the one switch for the household board. The board is **off by default** |
| 18 | `seed.sql` | the three policy tiers, placeholder children, and the always_allow rows |
| 19 | `schema-presence.sql` | `devices.present_at`: "on the wire right now", as distinct from `last_seen`, which comes from the lease list and outlives the device |
| 20 | `schema-appliance.sql` | a fourth device class, `appliance`: not a person's and not smart-home kit, so full internet, no owner, no time limits, never caught by a kids control |
| 21 | `schema-roles.sql` | the four household roles (child, guest-child, guest-adult, adult), the `people` view with the role flags, the `people_in_scope()` and `ips_in_scope()` scope functions, and `household_roster` |
| 22 | `schema-claim.sql` | device claiming: `claim_settings`, `device_claims`, `children.claim_pin`, `devices.claim_pending` and the `unclaimed_devices` view the gateway reconciles `kids_unclaimed` from. **Off by default** (`mode='off'`) |
| 23 | `schema-shared.sql` | the fifth device class, `shared`: the household's device rather than one child's. Adds `devices.policy_tier`, the two sweep columns `caught_by_dinner` and `caught_by_house_off`, the `device_sweeps` view that computes them and forces smart home, appliances and infrastructure out of every sweep, `device_state` (block state for a device with no owner), `house_state` plus `house_status` (the whole-house cut and the clock that lifts it), and `blocked_device_ips`, which is now the single query the gateway reconciles `kids_block` from. Replaces `device_roster`, `people_in_scope()` and `ips_in_scope()` |
| 24 | `schema-learn.sql` | the reading list, part one: fifteen `always_allow` rows with `scope='learn'`, reachable through a total cut so a child out of time can go and read |
| 25 | `schema-learn-intl.sql` | the reading list, part two: the New Zealand, Australian, UK and US curriculum bodies, libraries, museums and science agencies. About forty `learn` domains between the two files |
| 26 | `schema-schedule.sql` | scheduled bedtimes. Gives the long-unread `schedules` table the columns it was missing (`categories`, `updated_ts`, `set_by`) and its constraints, adds `schedule_overrides` (a holiday window), `schedule_extensions` (tonight only), `schedule_state` (the worker's memory of what it has asserted), the `schedule_windows(at)` time function and the `schedule_next` and `schedule_holding` views. Read by `bin/genkan-schedule`, the dashboard and the kid portal. **A fresh install has no rows, so it schedules nothing** |
| 27 | `schema-slow.sql` | the slow lane. Adds `category_state.speed` (the third state between on and off), `slow_settings` (how slow, and whether running out of time cuts or slows), the `slow_lane_ips` view the gateway reconciles the four `slow_*` sets from, and `slow_lane_children`. `slow_lane_ips` returns **personal devices only**, which is the iron rule that stops a camera or a smart lock ever being throttled. **A fresh install throttles nobody and still cuts at zero** |

These ordering constraints are load-bearing:

- `schema-devices.sql` must come **after** `schema-people.sql`. Both define the
  `device_roster` view; the later one adds `category` and `vendor`, and running
  them the other way around silently gives you a roster with no device class,
  which is what the dashboard and `genkan devices` read.
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
- `schema-packages.sql` must come **after** `schema-quizbanks.sql`, because
  `quiz_packages.bank_id` is a foreign key onto `quiz_banks(id)` and the
  `quiz_package_summary` view reads `quiz_bank_summary`. Nothing depends on it
  in turn: an install that has not loaded it still runs every quiz, it just
  cannot install a community package and the portal shows no read-first pages.
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
- `schema-shared.sql` must come **after** `schema-roles.sql`, because it
  replaces `people_in_scope()` and `ips_in_scope()`, and **after**
  `schema-devices.sql`, because it replaces `device_roster` and alters
  `devices`. Load it the other way round and you get the narrower scope
  functions back, which means `genkan dinner` stops reaching the family
  television and the whole-house cut stops existing. `gateway/entrypoint.sh`
  reads `blocked_device_ips` from this file, so a gateway image rebuilt against
  a database that has not loaded it logs a failed reconcile and keeps the
  firewall exactly as it is, rather than flushing it. See
  [HOUSEHOLD-ROLES.md](HOUSEHOLD-ROLES.md).
- `schema-schedule.sql` must come **after** `schema.sql` (it alters the
  `schedules` table that file creates) and after `schema-categories.sql` (its
  `schedule_holding` view reads `category_state`). It goes last because nothing
  else reads it at load time. It also disables, exactly once, any `schedules`
  row that predates its `categories` column: those rows were written when
  nothing read the table, so adopting them silently would switch a child's
  internet off on the first run after an upgrade. The `UPDATE` that does it can
  only match rows with a NULL `categories`, so re-running the file is a no-op.
- `schema-slow.sql` must come **after** `schema-categories.sql`, whose
  `category_state` table it adds the `speed` column to, and after
  `schema.sql`, whose `devices` table its `slow_lane_ips` view reads. It goes
  last because nothing else reads it at load time. `gateway/entrypoint.sh`,
  `bin/genkan-meter` and the dashboard all read it, and all three cope with it
  being absent: the gateway keeps the throttle sets exactly as they are, and
  the dashboard and portal simply never mention a slow lane.
- `schema-learn.sql` and `schema-learn-intl.sql` must come **after**
  `schema-safety.sql`, because both insert `always_allow` rows carrying the
  `scope` and `category` columns that file adds. They go last of all simply
  because they are pure content and nothing reads them at load time. Their rows
  reach the firewall through `genkan allow-sync` and the gateway's hourly
  refresh, not through the loader. See [READING-LIST.md](READING-LIST.md).

Load them:

```sh
config/db/load.sh kids_network            # or: config/db/load.sh <db> <postgres-container>
```

`config/db/load.sh` holds that order as an array and is the copy that actually
runs. It creates the `kids_app` role if it is missing, loads each file in turn,
prints one line per file and fails loudly on the first error. `test/schema-test.sh`
proves it against an empty database.

`config/db/grants.sql` runs **last**, on its own, deliberately outside that
array: it creates the `kids_agent` role and grants it rights on tables every
earlier file has to have created first, and keeping it out of the array means a
new schema file appended to the list cannot land after it by accident. See
[Roles](#roles).

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
earnable chores. The portal's chore buttons and `genkan earn <kid> <task>` both
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
approves on the dashboard or with `genkan earn`. Both land in the same
`time_events` audit trail.

## One table nothing reads

`schedules` (child, days, start and end minute, block or allow) is defined in
`schema.sql` and read by nothing. Bedtimes are not automatic yet: today they
are `genkan off` from a timer you write yourself, or a word to the agent. The
table is left in place because the design is settled and the column shape is
right; it is listed here so nobody assumes a row in it does something.

## Roles

Two roles, two jobs, and neither is a superuser.

**`kids_app`** is the HTTP-facing role. The portal, the dashboard, the voice
module and the gateway container connect as it, over TCP, with the password in
`secrets.env`. It holds only the SELECT, INSERT and UPDATE it needs on the app
tables. It has no rights over enforcement: the only audited path to the
firewall is `bin/genkan`.

**`kids_agent`** is the CLI and timer role, added on 2026-08-30. `bin/genkan`,
every `bin/genkan-*` worker and the two operator tools that read the database
(`tools/publish.sh`, the Omarchy widget) connect as it, over the local socket
inside the Postgres container. Its grants are in `config/db/grants.sql`, one
line per table, with a comment saying which script needs it.

Until 2026-08-30 all of those ran as the Postgres **superuser**, on an instance
this box shares with unrelated projects. That was the finding that mattered
most in the 2026-08-30 security review, and it was not really about SQL
injection: a superuser connection can run `COPY ... TO PROGRAM`, which is
command execution inside the database container, and can read and write every
other database on the server. So one bad argument in a shell script was one
step from the whole box. As `kids_agent` the same bad argument can at worst
scribble on Genkan's own rows.

What `kids_agent` deliberately cannot do, each one proved by
`test/db-role-test.sh`:

- `COPY ... TO PROGRAM` and `COPY ... FROM '/file'`: refused. It is not a
  member of `pg_execute_server_program` or `pg_read_server_files`.
- `pg_read_file()`, `pg_ls_dir()`: refused.
- `DROP`, `ALTER`, `TRUNCATE` anything: refused. It owns nothing.
- `DELETE FROM children`, `dns_log` or `time_events`: refused. A bad argument
  cannot erase a child, a device, or the history of either.
- Make itself a superuser, create a role, or grant itself a `pg_*` role:
  refused.
- Log in from anywhere but the local socket: it has **no password**, so the
  `host all all all scram-sha-256` line in `pg_hba.conf` can never authenticate
  it. That is also why the gateway container stays on `kids_app`: it reaches
  Postgres over TCP and needs a password role.

`kids_network` itself is now closed to `PUBLIC`: only `kids_app`, `kids_agent`
and a superuser may connect, so another project's role on the same server
cannot open the household's database. The mirror of that, fencing `kids_agent`
out of *other* projects' databases, is not something Genkan does for you: it
would mean editing an ACL Genkan does not own. `kids_agent` has no rights on
any table anywhere else, so the most it could do is read another database's
catalogue. If you want even that closed, see OPERATIONS.md.

### What still runs as the superuser, on purpose

Each one is work a least-privilege role must not be able to do for itself, and
each is commented at the call site with the words SUPERUSER PATH and the
reason. If you add another, do the same, and say why in a sentence. Grepping
for that phrase is how you audit the list.

1. `config/db/load.sh`: creates the roles and loads the schema. DDL, and the
   `CREATE ROLE` that makes `kids_agent` exist at all.
2. `deploy.sh`: `ALTER DATABASE ... SET timezone` (owner-or-superuser work),
   and applying `config/db/grants.sql`. Its one operator-supplied value,
   `GENKAN_TZ`, is checked to a timezone name's alphabet first.
3. `demo/reseed.sh`: drops and rebuilds the whole public schema nightly. It
   only ever talks to `genkan-demo-db`, a throwaway container on its own
   network with its own volume and a made-up family in it.
4. `bin/genkan-upgrade` and `bin/genkan-rollback --with-db`: `pg_dump` before an
   upgrade, and restoring that dump afterwards. A backup has to read every
   table, and a restore recreates tables, views and grants. Fixed command
   lines, no operator-supplied values, and the rollback copies what it is about
   to replace first.

The test scripts in `test/` also connect as the superuser. They create and drop
databases, and they delete their own fixture rows, which is exactly the set of
things `kids_agent` is not allowed to do.

### Adding a verb

If you add a `genkan` verb that touches a table not in `config/db/grants.sql`,
add its grant there too, or the verb fails with `permission denied`. Grant the
narrowest verb list that works, and say in the comment which script needs it.
Then run `bash test/db-role-test.sh`.

## The two connection strings

- `KIDS_DB_URL`: how **host** processes reach Postgres, via the published
  loopback port. Used by the dashboard and, where a tool reads it at all, the
  host-side genkan tools.
- `KIDS_DB_URL_DOCKER`: the same database as a **container** sees it, via the
  Postgres network alias. Used by the portal and the gateway. Which one is
  picked is decided by the `IN_CONTAINER` flag compose sets.

Both live in the gitignored `secrets.env`.

## The day boundary

Daily budgets reset at midnight in the **database's** timezone, and the Postgres
container runs UTC by default. Without pinning it, a New Zealand family's screen
time rolls over at noon. `deploy.sh` sets it from `GENKAN_TZ` in `config.env`:

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
