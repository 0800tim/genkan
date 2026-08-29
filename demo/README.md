# The public demo

<https://hearth-demo.appspurt.dev>

The real Hearth dashboard, running against a database full of a household that
does not exist. There is no second copy of the dashboard anywhere: this stack
bind-mounts `../dashboard` read only and runs `node server.mjs`, the same file
`kids-dashboard.service` runs at home. Improve the dashboard and the demo
improves with it, on the next restart. That is the whole point of building it
this way.

## What it is made of

| Piece | What it does |
|---|---|
| `compose.yaml` | Two containers: `hearth-demo-db` (its own Postgres, its own volume, its own network) and `hearth-demo-dashboard` (node:22-slim, the repo's `dashboard/` mounted read only). |
| `seed.sql` | The made-up household, six weeks of it, all written relative to `now()`. |
| `reseed.sh` | Empties the demo database, loads every `config/db/schema*.sql` in order, then `seed.sql`. |
| `../dashboard/live-demo.mjs` | The synthetic sampler that keeps the Right Now page moving. |

Published on `127.0.0.1:9275`, fronted by the existing `hearth` Cloudflare
tunnel (`~/.cloudflared/config-hearth.yml`, the same tunnel that serves
`hearth.appspurt.dev`). The Postgres container publishes nothing at all.

## Why it cannot touch the real network

This box is running a real household's gateway. Five separate things have to
hold for the demo to be inert, and none of them is a matter of trust:

1. **Its own database.** A separate Postgres, a separate volume, a separate
   Docker network. It has no route to the shared `postgres` container and no
   credentials for it.
2. **No docker socket.** `dashboard/live.mjs` reaches the gateway with
   `docker exec`, and that is the only way anything in a container could get at
   `nft` or `hearth-gw`. The socket is not mounted, so the call cannot succeed
   whatever the code does.
3. **`HEARTH_DEMO=1`.** In `dashboard/server.mjs` this replaces `runKidnet` and
   `runTool` with functions that return
   `{ok:true, out:"This is the demo, so nothing was actually changed."}`.
   Every path that would shell out, including `syncAdguard`, goes through one of
   those two, so nothing reaches `execFile`. In `dashboard/live.mjs` it returns
   early from `tick()` and `ensureTotals()`, which are the only two places that
   run `docker`.
4. **`bin/` is not mounted.** Even if a call got through there would be no
   `kidnet` in the container to run.
5. **No capabilities.** No `NET_ADMIN`, no host networking, no privileged flag.

With `HEARTH_DEMO` unset, which is every household installation, all of the
above is a strict no-op: the guards are ternaries that evaluate to exactly the
code that was there before, and the demo banner is the empty string.

Writes the demo *can* do are writes to its own throwaway database: setting a
goal, acknowledging an alert, editing a job on the Learn to earn page. That is
deliberate, because it lets a visitor actually use the thing. The nightly
re-seed puts it all back.

## Running it

```sh
# Start or restart
systemctl --user restart hearth-demo.service
# or, straight from the repo
docker compose -f demo/compose.yaml up -d

# Stop
systemctl --user stop hearth-demo.service

# What is it doing
docker compose -f demo/compose.yaml ps
docker compose -f demo/compose.yaml logs -f demo-dashboard
```

`restart: unless-stopped` on both containers is what actually survives a reboot.
`hearth-demo.service` is enabled as well, so a docker daemon that came up empty
still gets a nudge.

## Re-seeding

```sh
demo/reseed.sh                                  # by hand
systemctl --user start hearth-demo-reseed.service   # the same thing, logged
```

`hearth-demo-reseed.timer` runs it at about 03:40 every night. Two reasons:

- every timestamp in `seed.sql` is relative to `now()`, so a nightly rebuild
  means the charts are always showing the last six weeks rather than the six
  weeks before whenever it was last touched, and
- anything a visitor changed goes back the way it was.

It takes about three seconds and drops the schema first, because the repo's
schema files are individually idempotent but the whole set is not re-runnable
over itself (`schema-people.sql` recreates the `people` view that
`schema-roles.sql` has since widened).

## Picking up dashboard changes

The dashboard source is mounted, not copied, so a change to `dashboard/*.mjs`
only needs the process restarted:

```sh
docker compose -f demo/compose.yaml restart demo-dashboard
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
fake numbers. It is only ever loaded when `HEARTH_DEMO=1`.
