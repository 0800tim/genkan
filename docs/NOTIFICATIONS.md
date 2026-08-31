# Notifications to a parent's phone

Genkan already knows the things a parent needs to hear. A device nobody has
claimed joining the network. A household camera that is not as restricted as the
policy says. A Tor or self-harm signal. A child out of time. Until this layer,
every one of them sat on a dashboard, which meant a parent could learn on
Saturday that something concerning happened on Wednesday.

**Status: two routes built and tested, two documented and refused.** ntfy and a
webhook ship, with tests. Email and a first-class Home Assistant route do not,
and `genkan-notify` refuses to create them rather than accepting a route that
would quietly never send anything. The extension points are at the end of this
file. Nothing here is on until a household adds a route: a fresh install sends
nothing to anybody, and `test/schema-test.sh` proves it.

## The constraint that shapes all of it

**Genkan has no telemetry, talks to no cloud, and that stays true.** So a
notification is never "we send your child's activity to a service". It is the
household's own box POSTing a short message the household worded, to an address
the household typed in, over a route the household controls and can delete.

Nothing in this layer calls a vendor. There is no Genkan server, no account, no
opt-out to find. If you add no route, nothing is ever sent anywhere, and the
worker says so every time it runs.

## What lands on a phone, and why it says so little

A push notification is read out of context. It arrives on a lock screen, in a
queue at the supermarket, possibly in front of the child it is about, possibly
in front of somebody reading over a shoulder. So the rule is:

> **The notification says that something needs a parent's eyes and where to
> look. The detail stays on the dashboard, at home, on the private network.**

The wording lives in the database, in `notify_wording`, as data rather than as
string literals in a script. Three reasons: a household can change it without
editing code, a reviewer can read the whole set in one query, and the two rules
that matter are enforced by columns rather than by remembering.

| column | means |
|---|---|
| `name_ok` | may this message name a child? |
| `detail_ok` | may it carry the alert's own text, which can contain a domain? |

Both are **false** for every sensitive category, and a route's `include_detail`
can only widen as far as `detail_ok` already allows. So no route setting, and no
mistake in the worker, can put a child's name or a child's browsing on a lock
screen for the categories where that would be wrong.

### The self-harm alert

This is the one the whole design is bent around. `docs/tor-and-safety.md` sets
the tone rules for the portal, and they apply doubly here, because a portal page
is read by one child in one room and a notification is read wherever the phone
happens to be.

> **Genkan: worth a quiet check in**
>
> One thing today needs your eyes, and it is a care thing, not a trouble thing.
> The detail is on the Genkan dashboard at home. Read it somewhere private.

Every word of that is a decision:

- **No child's name.** A notification that says a named child looked at
  something is an accusation on a lock screen, in front of whoever is standing
  there. The parent knows which children live in the house; the dashboard says
  which one.
- **No site, and not even the category.** "Self-harm" on a lock screen tells a
  passer-by, a sibling or the child themselves something that is theirs to tell.
  It also freezes a parent in public with nothing they can do about it.
- **"A care thing, not a trouble thing."** The response to this signal is a
  conversation, never a punishment. The message that starts the parent's evening
  should start it in the right register, because the first ten seconds of the
  conversation are set by the first thing the parent read.
- **"Read it somewhere private."** The one instruction that matters. It is the
  notification telling the parent not to open the dashboard on the bus.
- **Priority 5**, the highest ntfy offers, so it shows on a phone in
  do-not-disturb. It is the only category that gets it.

The blocked-road categories (`tor`, `darknet`, `drugs`, `extreme`) read
"Genkan: worth a conversation tonight ... It was blocked. Nobody is in trouble."
Same reasoning: `docs/tor-and-safety.md` is explicit that a kid bouncing off the
Tor block is not automatically in trouble, so the message that reaches a parent
must not read as a charge.

The routine ones are allowed to say what they are, because none of them is
about a child's private business:

> **Genkan: a device nobody has claimed joined the network**
> 12 devices nobody has claimed joined the network. They have limited access
> until somebody names them.

A category with no wording row at all falls back to "Genkan: something needs a
look", which names nobody and quotes nothing. That direction is deliberate: a
new alert type is never assumed harmless enough to quote.

## The four promises

**Never the same thing twice.** `notify_sent` has `UNIQUE (route_id, alert_id)`.
That constraint is the mechanism, not the code around it: two overlapping runs
cannot both send the same alert, because the second INSERT loses. A duplicate
safety alert at 2am is how a parent learns to ignore them.

**One buzz, not twelve.** Two levels of collapsing, and the line between them is
severity, because that is the line between a signal and a chore.

- Alerts are grouped **by category**, so twelve unknown devices joining at once
  is one message that says "12 devices", never twelve messages.
- **Urgent and warn** groups each get their own message with their own words. A
  safety signal buried inside "4 things need a look" is a safety signal nobody
  reads.
- **Info** is the routine pile. One info category keeps its own words; two or
  more collapse into a single summary message, because none of them is worth a
  second buzz.

**Quiet by default about the routine.** A new route defaults to `warn`, so a job
waiting for approval never fires. Quiet hours hold everything ordinary until
morning; urgent still goes through, unless a household turns that off, and the
setting says plainly what turning it off means. Per route there is also a
minimum gap between messages (45s), an hourly cap (6 ordinary, 12 urgent), and a
horizon: an alert older than 12 hours when a route first sees it is retired
unsent, so restoring a backup or adding a route on a Saturday cannot fire a week
of history at somebody's phone.

**Fail silently to the parent, loudly to the log, and never lose the alert.**
Rows are written to `notify_sent` only *after* a send succeeds. A route that is
down writes nothing, so the alert stays unacknowledged and unsent and goes next
time. The worker exits 0 whatever happens, so a broken route can never fail a
timer or block anything else, and every attempt lands in `notify_log` with the
route's **name and kind and never its address or its token**. That log is safe
to paste into a bug report.

## Setting one up

On the dashboard: **Notifications**. Or from the shell:

```
genkan-notify add ntfy dad-phone
  Target URL (an ntfy topic URL, or a webhook URL): ‹typed, not echoed›
genkan-notify test dad-phone
```

Leave `--target` off and you are prompted, which keeps the URL out of your shell
history and out of `ps`. **For an ntfy route the topic name is the password**:
anyone who knows it can read your notifications and post to them. Make it long
and random (`openssl rand -hex 16`), and better still run your own ntfy server so
the messages never touch anybody else's.

Then prove it. A notification setup nobody has tested is a notification setup
that does not work, which is why both the CLI and the page push you at the test
button the moment a route is added.

```
genkan-notify list                  the routes, their state, their last result
genkan-notify pending               what would go next, without sending it
genkan-notify set dad-phone --quiet 21:30-07:00
genkan-notify set dad-phone --severity urgent
genkan-notify log 20                the last attempts, good and bad
```

Everything is in `docs/CLI.md`.

### Where the secrets live

A target URL and a token are secrets, and they live in **one place: the
database**, in `notify_routes`. Never in a tracked file, never in `config.env`,
never in a log line, and never on a command line where `ps` can read them. The
worker hands them to its sender in environment variables, and the sender scrubs
them out of any error message before it comes back, because urllib is happy to
put a whole URL in an exception and that exception ends up in the journal.

The dashboard shows only a route's **host** (`https://ntfy.sh`), which is enough
to tell two routes apart and gives away nothing.

## Which alerts exist today

Be honest about this, because the notifier can only send what something raises.
Today the `alerts` table is written by four things:

| category | raised by | severity |
|---|---|---|
| `self-harm`, `tor`, `darknet`, `drugs`, `proxy-vpn`, … | `bin/genkan-alerts`, from flagged DNS lookups | from `flag_domains` |
| `iot-policy` | `bin/genkan-iot-policy` when the household policy does not apply cleanly | `warn` / `urgent` |
| `gateway` | `gateway/entrypoint.sh`, mostly the segment guard | `urgent` |
| `dns-ingest` | `bin/genkan-dnslog` when it cannot read AdGuard's query log | `urgent` |

Wording is seeded and ready for `devices` (a device nobody has claimed), `time`
(a child out of time) and `earn` (a job waiting for approval), **but nothing
raises those rows on a real box yet.** They appear in the public demo, because
`demo/seed.sql` writes them by hand. So a route set to "everything" today will
be quieter than the wording table suggests, and that is a gap in the alert
producers, not in this layer. Two more are listed in `docs/tor-and-safety.md`
and `RECOMMENDATIONS.md` as still-missing tripwires.

## Extension points

Two routes are declared in the schema and refused by the worker, on purpose: a
half-built route that accepts a configuration and then never sends anything is
worse than no route, because a parent believes they are covered.

**Email**, via a household's own SMTP server. The place for it is the sender in
`bin/genkan-notify` (`PY_SEND`), which already receives the title, the body, the
priority and the target in its environment. It needs the server, port, username
and password on the route, which means new columns on `notify_routes`, and it
needs to keep the same rule as everything else: the body is the safe wording,
not the alert row. An email is only slightly more private than a lock screen; it
is read on the same phone.

**Home Assistant, directly.** It works today behind a webhook: point a route at
an HA webhook trigger and the JSON body arrives as `trigger.json`. A first-class
route would post to `/api/services/notify/notify` with a long-lived token, which
is one more `elif` in the same sender. Worth doing, because HA is the thing many
self-hosters already run, and it puts the household back in charge of which
phones ring.

Both should arrive with tests in `test/notify-test.sh` and a row in the table at
the top of this file that stops saying "not built".

## Tests

```
test/notify-test.sh        41 checks, no sudo, its own throwaway database and
                           its own local listener. It never touches the
                           household database and never sends anything to a
                           real address.
test/schema-test.sh        proves a fresh install has no routes, and that the
                           sensitive wording rows may name nobody and quote
                           nothing.
```

The assertion to keep if you keep only one: a self-harm alert, on a route that
has asked for every detail it is allowed to have, still reaches the phone with
no child's name, no site, and no word that says what it is about.
