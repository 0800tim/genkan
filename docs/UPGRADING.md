# Updating Genkan, and what to do when it goes wrong

This is written for the person whose house it is. You do not need to know what
nftables is.

Genkan sits between your family and the internet. A bad update here does not
mean an app looks funny: it means the children cannot do their homework and
the dashboard you would use to fix it is down as well. Everything below is
built around that one fact.

## The short version

```bash
genkan-upgrade                 # is there anything new? Changes nothing.
sudo genkan-upgrade apply      # install it
genkan-health                  # is my household working?
sudo genkan-rollback list      # what I can go back to
sudo genkan-rollback to previous
```

If an update breaks something, **you do not have to do anything**. Genkan
checks the household after every update and puts the old version back by
itself if it is not working. The rollback commands above are for the case
where the problem shows up later, or where you simply changed your mind.

## What am I running?

```bash
genkan-health
```

The first line is the version. It is also at the bottom of every page of the
dashboard, next to a dot: green means the household is working.

Versions are dated, so you can tell at a glance how old yours is. `2026.09.0`
is the first release of September 2026. See [RELEASING.md](RELEASING.md) for
why it is done that way.

If the line says something like "12 change(s) since the release", this box is
running code that is newer than the last release. That is normal on a
developer's machine and unusual in a household.

## What an update actually does

`sudo genkan-upgrade apply` does these in order, and stops at the first one
that fails.

1. **Fetches** the newest release. It follows releases, not the development
   branch, so you get versions somebody decided were finished.
2. **Checks the new version before switching to it**, in a throwaway copy,
   while your household carries on as normal:
   - the firewall ruleset has to parse (`nft -c`),
   - the database structure has to load into an empty database from scratch
     (`test/schema-test.sh`),
   - every script has to be valid.
   If any of these fail, **nothing changes** and you will not notice there
   was an update.
3. **Snapshots** everything needed to undo it: a full database backup, the
   exact version you are on, and any edits you have made to this box. The
   snapshot also gets its own copy of the rollback tool, because if the new
   version is broken enough to fail, its own rollback tool is not the thing
   to trust.
4. **Installs** the new version and restarts the stack (this is `deploy.sh`,
   the same thing a first install runs).
5. **Checks your household is actually working**: containers up, firewall
   loaded, name lookups answering, the children's page serving, the database
   readable, the safety net live.
6. **Puts the old version back automatically** if step 5 fails.

It is safe to run twice: an update to a version you already have says so and
does nothing. It is safe to interrupt: if you kill it half way, the next run
picks up where it stopped, and rolls back if the box is not healthy.

## When it goes wrong

### The update refused to start

You will see `REFUSING TO UPGRADE` and a reason. Nothing was changed and your
household is still working. This is the tooling doing its job. Report the
release: <https://github.com/0800tim/genkan/issues>

### The update went on and rolled itself back

You will see `Putting Genkan <old version> back`. It is already done. Your
household is on the version that worked. Please report the release that
failed, with the output.

### The internet is broken and I do not know why

```bash
genkan-health
```

Read the lines marked FAIL. Each one says what to do. The most common answers
have nothing to do with Genkan at all: the broadband is down, the wifi access
point has been reset or re-bridged to the main network, or the USB network
adapter has been knocked out of its socket.

### I want to go back

```bash
sudo genkan-rollback list        # what is available, and how old each one is
sudo genkan-rollback to previous # the most recent one
```

By default this puts **the code** back and leaves your database alone, so
nothing the children earned since is lost. Read the next section before
reaching for `--with-database`.

### Nothing works and the tools will not run

Everything a rollback needs is in one directory and can be done by hand:

```bash
ls /var/lib/genkan/releases/                  # the snapshots
cat /var/lib/genkan/releases/<id>/manifest.env  # which commit to go back to

cd /srv/.../kids-network                      # wherever your copy lives
git checkout --force --detach <from_commit>   # from the manifest
sudo ./deploy.sh

# and only if you have decided you need the database back as well:
gunzip -c /var/lib/genkan/releases/<id>/db.sql.gz \
  | docker exec -i postgres psql -U postgres -d kids_network
```

The manifest is a plain text file of `key=value` lines and the backup is an
ordinary gzipped SQL dump. Neither needs any Genkan tooling to read. That is
deliberate: the day you need them is the day the tooling might be the broken
thing.

## What a rollback can and cannot undo

Read this part before you need it.

### It can

- **Put the code back.** Every file, exactly as it was, plus a re-run of
  `deploy.sh`, so the containers, the firewall, the commands in
  `/usr/local/bin` and the background jobs all go back with it.
- **Put the database back**, if you ask for it with `--with-database`, to
  exactly how it was when the snapshot was taken.
- **Protect edits you made by hand.** Uncommitted changes on the box are
  snapshotted to a separate git ref before anything happens
  (`tools/worktree-snapshot.sh list`), and an upgrade refuses to overwrite
  them unless you pass `--allow-dirty`.

### It cannot

- **Give you back both the old structure and the new data.** A database
  restore is a restore. It replaces what is in the database now with what was
  in it at the snapshot, and everything in between is gone: minutes the
  children earned, quizzes they passed, chores they claimed, devices that
  joined, and the whole DNS log. That is why `--with-database` is off by
  default and why it makes you type `ROLLBACK` in full.
- **Undo a database change on its own.** If a release added a column, rolling
  the code back without the database is usually fine: the old code ignores a
  column it has never heard of. If a release **dropped or renamed** something,
  the old code will look for a thing that is no longer there and will fail. In
  that case `--with-database` is not optional on the way back. Each release's
  notes below say which kind it was.
- **Recover anything older than the snapshots it kept.** Only the ten most
  recent are kept, so that a box does not fill its own disk with backups.
- **Fix a problem that was never Genkan's.** If your broadband is down, every
  version will look broken and none of them is the cause. `genkan-health` says
  plainly that it cannot check your broadband, precisely so that this is not
  confusing at 9pm.
- **Undo anything on the AdGuard side that was changed by hand.** AdGuard
  keeps its own configuration in its own container volume, which is not part
  of the snapshot. `genkan-adguard apply` rebuilds the parts Genkan manages,
  from the database, and always did.

A rollback is a way back to a version that worked. It is not a time machine,
and this file will not pretend otherwise.

## Automatic updates

There are none, and that is a decision rather than an omission. An update to
this software can take a household's internet away, and starting one at 3am
with nobody awake to read the output is not a service to anybody. The tooling
is built so that a person can update in one command and get out of it in one
command. That is the intended amount of automation.

If you want to know when there is something new without installing it,
`genkan-upgrade check` changes nothing and is safe to run on a timer.

---

# Release notes

Newest first. Each release says whether it touches the database, because that
is the one thing that changes how a rollback behaves.

## 2026.09.0

The first numbered release. Everything before this was a working prototype
with no version number, no way to know what you were running, and no way to go
back.

- Adds `VERSION`, `bin/genkan-health`, `bin/genkan-upgrade` and
  `bin/genkan-rollback`.
- The dashboard now shows the version and the health of the household at the
  bottom of every page.
- The product is called Genkan (it was Hearth). The command is `genkan`, with
  `kidnet` kept as an alias. The tools are `genkan-health`, `genkan-upgrade`
  and `genkan-rollback`, and the background workers are `genkan-*` too (they
  were `kidnet-*`; the old names are removed from `/usr/local/bin` on deploy,
  and `bin/` keeps shims for the three tools so an older box's installed
  upgrader can finish its own run). The containers are `genkan-gw`,
  `genkan-adguard`, `genkan-portal` and `genkan-speedtest`; the config keys
  are `GENKAN_*`; state lives under `/var/lib/genkan`.

**Coming from a box that said Hearth:** `sudo ./deploy.sh` does the whole
rename in one run and prints each step. It renames the `HEARTH_*` keys in your
config.env (keeping a copy as `config.env.pre-genkan`), moves
`/var/lib/hearth` to `/var/lib/genkan`, copies AdGuard's settings and DHCP
leases into the new volumes, removes the old containers and starts the new
ones. The kids' network is down for about a minute while the new gateway
starts and the warden hands it the NIC, so run it when nobody is on it. The
database is not touched. Two things it cannot rename for you, because they
are outside the checkout: a `hearth-dashboard-tls.service` you created from
`tools/enable-https.sh` (re-run the script; it now writes
`genkan-dashboard-tls.service` under `/var/lib/genkan/tls`), and any alias or
bookmark of your own that says `hearth`.

**Database:** adds one new table, `release_history`, and two views. Nothing is
dropped or renamed, so a rollback from a later version to this one does not
need `--with-database`.

**Coming from an unversioned box:** run `sudo ./deploy.sh` once from your
checkout. It installs the three new commands and creates
`/var/lib/genkan/releases`. There is nothing to roll back to until your first
upgrade, and `genkan-rollback list` will say so.
