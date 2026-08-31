# The public demos

| | |
|---|---|
| <https://demo.genkan.nz> | the parent's dashboard |
| <https://quiz-demo.genkan.nz> | the child's captive portal and the quizzes |

The real Genkan code, running against a database full of a household that does
not exist. There is no second copy of anything: this stack bind-mounts
`../dashboard` read only and runs `node server.mjs` and `node portal.mjs`, the
same files a household runs. Improve the dashboard or the portal and the demos
improve with them, on the next restart. That is the whole point of building it
this way.

## What it is made of

| Piece | What it does |
|---|---|
| `compose.yaml` | Three containers: `genkan-demo-db` (its own Postgres, its own volume, its own network), `genkan-demo-dashboard` and `genkan-demo-portal` (both node:22-slim, the repo's `dashboard/` mounted read only). |
| `seed.sql` | The made-up household, six weeks of it, all written relative to `now()`. One child is deliberately out of time. |
| `reseed.sh` | Empties the demo database, loads every `config/db/schema*.sql` in order, then `seed.sql`. |
| `../dashboard/live-demo.mjs` | The synthetic sampler that keeps the Right Now page moving. |
| `../dashboard/sys-demo.mjs` | The invented box the System page describes: four cores, 8 GB, a 128 GB disk, three containers. Not this host. |

Published on `127.0.0.1:9275` (dashboard) and `127.0.0.1:9276` (portal), fronted
by the existing `genkan` Cloudflare tunnel (`~/.cloudflared/config-genkan.yml`,
the same tunnel that serves `hearth.appspurt.dev`). The Postgres container
publishes nothing at all.

## Why it cannot touch the real network

This box is running a real household's gateway. Five separate things have to
hold for the demo to be inert, and none of them is a matter of trust:

1. **Its own database.** A separate Postgres, a separate volume, a separate
   Docker network. It has no route to the shared `postgres` container and no
   credentials for it.
2. **No docker socket.** `dashboard/live.mjs` reaches the gateway with
   `docker exec`, and that is the only way anything in a container could get at
   `nft` or `genkan-gw`. The socket is not mounted, so the call cannot succeed
   whatever the code does.
3. **`GENKAN_DEMO=1`.** In `dashboard/server.mjs` this replaces `runKidnet` and
   `runTool` with functions that return
   `{ok:true, out:"This is the demo, so nothing was actually changed."}`.
   Every path that would shell out, including `syncAdguard`, goes through one of
   those two, so nothing reaches `execFile`. In `dashboard/live.mjs` it returns
   early from `tick()` and `ensureTotals()`, which are the only two places that
   run `docker`.
4. **`bin/` is not mounted.** Even if a call got through there would be no
   `kidnet` in the container to run.
5. **No capabilities.** No `NET_ADMIN`, no host networking, no privileged flag.

With `GENKAN_DEMO` unset, which is every household installation, all of the
above is a strict no-op: the guards are ternaries that evaluate to exactly the
code that was there before, and the demo banner is the empty string.

Three more things the flag changes, all of them so the demo shows something
rather than nothing:

- **The System page reads an invented box.** This container has no docker
  socket, and its cgroup numbers describe a shared server in a datacentre rather
  than a family's gateway. Reading them would be both meaningless and a small
  leak of somebody else's machine, so `sys-demo.mjs` supplies the sample and
  `/proc` is never opened.
- **The portal's `?kid=` override may earn.** At home that override is view
  only: a POST has to come from that child's own device, because earning from
  somebody else's would let one child farm another's minutes. The demo has no
  real devices at all, so under that rule the quizzes could be read and never
  played. The flag lifts the device match, and only that.
- **Every portal page carries a banner** saying it is a demo with an invented
  family. Without it a screenshot of a child's name beside a real-looking clock
  would travel as the real thing.

Writes the demo *can* do are writes to its own throwaway database: setting a
goal, acknowledging an alert, editing a job on the Learn to earn page. That is
deliberate, because it lets a visitor actually use the thing. The nightly
re-seed puts it all back.

## Running it

```sh
# Start or restart
systemctl --user restart genkan-demo.service
# or, straight from the repo
docker compose -f demo/compose.yaml up -d

# Stop
systemctl --user stop genkan-demo.service

# What is it doing
docker compose -f demo/compose.yaml ps
docker compose -f demo/compose.yaml logs -f demo-dashboard
```

`restart: unless-stopped` on all three containers is what actually survives a
reboot.
`genkan-demo.service` is enabled as well, so a docker daemon that came up empty
still gets a nudge.

## Re-seeding

```sh
demo/reseed.sh                                  # by hand
systemctl --user start genkan-demo-reseed.service   # the same thing, logged
```

`genkan-demo-reseed.timer` runs it at about 03:40 every night. Two reasons:

- every timestamp in `seed.sql` is relative to `now()`, so a nightly rebuild
  means the charts are always showing the last six weeks rather than the six
  weeks before whenever it was last touched, and
- anything a visitor changed goes back the way it was.

It takes about three seconds and drops the schema first, because the repo's
schema files are individually idempotent but the whole set is not re-runnable
over itself (`schema-people.sql` recreates the `people` view that
`schema-roles.sql` has since widened).

## Picking up code changes

The source is mounted, not copied, so a change to `dashboard/*.mjs` (which is
where `portal.mjs` lives too) only needs the processes restarted:

```sh
docker compose -f demo/compose.yaml restart demo-dashboard demo-portal
```

A change to `config/db/schema*.sql` needs `demo/reseed.sh` as well.

## The household in the demo

Made up, and deliberately not the household this box actually serves. Two
adults (Callum and Marama), three children on three different filter levels
(Piper 14, Rangi 11, Nova 7), one visiting child (Ari) and one visiting adult
(Dorothy), so the four household roles are all visible at once. Every MAC is in
`02:00:00:`, the locally administered range, so none of them can collide with
real hardware. Addresses are all in the documentation subnet the reference
gateway uses.

The six weeks of history carry a story rather than noise: Piper's gaming
minutes fall from about two hours a day to about forty minutes while her
learning minutes climb, which is what makes the goals feature mean something on
the Week and Trends pages.

## The live page

`dashboard/live.mjs` samples `/proc/net/dev` and the nftables counters inside
the gateway container. A demo has neither, and no socket to reach them with, so
the Right Now page would sit at zero saying the gateway did not answer.
`dashboard/live-demo.mjs` synthesises the same tick shape instead: a slow random
walk per device, clamped, multiplied by a daily rhythm and split across the
categories that device's owner would plausibly be using. Real dashboard code,
fake numbers. It is only ever loaded when `GENKAN_DEMO=1`.
