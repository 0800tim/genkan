# Adding a service Genkan doesn't know yet

Genkan counts a child's gaming and video time by watching which addresses
their device talks to, learned from DNS lookups (see
[METERING.md](../METERING.md)). That only works for a service if its domains
are in the map. The map is seeded from a New Zealand household and is nothing
like exhaustive: your country's catch-up TV, your kid's new game, the music
app everyone at school uses. None of that requires touching a firewall rule or
writing code. It is two SQL files, and this is the easiest way for a
non-programmer to make a real contribution to Genkan.

This is the plain version. If you have not already, read METERING.md first:
the reasoning below only makes sense once you know why a shared address is
dangerous to tag.

## Step 1: find out what a service actually talks to

Guessing the "obvious" domain is usually wrong. Nobody streams video from
`netflix.com`, they stream it from `nflxvideo.net`. The front door is a few
kilobytes of page; the CDN is the gigabytes that should count as screen time.
The honest way to find the real answer is to watch your own house's DNS log
while the service is actually being used:

    genkan recent <kid> 1

shows every domain that child's devices looked up in the last day, newest
first. Have them open the app or the website, use it for a couple of minutes,
then run this straight after and read down the list. The domains that repeat
while video is playing, or that appear only once the show actually starts
rather than when the app just opens, are the ones that matter.

    genkan topsites 1

does the same thing the other way round: every domain any child looked up
today, ranked by how often. A service that is being used a lot but is missing
from `category_domains` will still show up here, just uncategorised, and the
dashboard's Trends page will show its bytes as "other" rather than under its
own name. That mismatch, a service you know your kids use showing up nowhere
on Trends, is usually the first sign that a domain is missing.

Both commands read `dns_log`, which is exactly what the dashboard's own Trends
and Right now pages are built from: nothing here needs access the household
does not already have.

## Step 2: verify every domain before you add it

    getent ahostsv4 the-domain-you-found.example

If it does not resolve, do not add it: a typo or a dead domain in the map does
nothing but sit there. This is a hard rule, not a suggestion; every domain in
the current seed was checked this way before it went in.

## Step 3: work out where it belongs, and where it must not go

Two files, two different jobs:

- **`config/db/schema-categories.sql`** (`category_domains` table): domain ->
  category (`gaming`, `video`, `social`, `audio`, `messaging`, `schoolwork`,
  `download`). This is what a time budget is charged against.
- **`config/db/schema-services.sql`** (`services` and `service_domains`
  tables): domain -> named service ("TVNZ+", "Roblox"). This is what lets the
  dashboard say "312 MB to TikTok" instead of just "video".

A domain usually wants a row in both: the category decides whether it costs
screen time, the service decides what it is labelled. Add to `category_domains`
first; the service label is the finishing touch, not the part that makes
metering work.

**Before you add a CDN hostname, ask: does anything else use it?** This is the
one rule that matters more than any other in this file, because getting it
wrong does not just miss a service, it wrongly tags an unrelated one. It has
already happened once in this project: a single Google edge address, learned
from a bare `googlevideo.com` lookup, was tagged `video`, and it then coloured
every byte any phone in the house sent to Google (search, Gmail, the Play
Store) as YouTube. Read the CDN-apex guard comment at the top of
`bin/kidnet-catmap` for the full story.

So:

- **A service's own domain is always safe** (`tvnz.co.nz`, `stan.com.au`,
  `roblox.com`). Nobody else can be running traffic through another
  organisation's registered domain.
- **A dedicated subdomain under a shared CDN is usually safe**, because the
  hostname itself still belongs to one vendor even though the network under it
  is generic (`dashvod.skygo.co.nz` and `iview.abc.net.au` both resolve to a
  shared Akamai edge, but the *name* is Sky's and ABC's alone; nobody else was
  handed that exact hostname).
- **A bare CDN apex is never safe to add** (`akamaized.net`, `cloudfront.net`,
  `fastly.net`, plain `brightcove.com`). These are shared by thousands of
  unrelated customers. If a service's video turns out to live on one of these
  with no vendor-specific hostname you can find, that is a real limit, not a
  gap to paper over: leave it out, and say so in a one-line comment next to
  where you looked, the same way the existing seed does for the services it
  had to leave half-mapped. Under-counting a category is always a smaller lie
  than colouring unrelated traffic with it.
- **A broadcaster's own domain that also carries its general news site is a
  judgement call, not an automatic exclusion.** `tvnz.co.nz`, `bbc.co.uk` and
  `itv.com` all carry news text on the same domain as their video. That is
  already in the seed and is left alone deliberately: a news article load is a
  short burst, not the sustained throughput the active-minute threshold looks
  for, so it is not what trips a budget in practice. Where the broadcaster runs
  its news on a genuinely separate domain instead (ABC's news site is not
  `iview.abc.net.au`, CBC's is not `gem.cbc.ca`), prefer the narrower,
  dedicated domain and leave the news site out.

Follow the `ON CONFLICT DO NOTHING` pattern already in both files exactly, and
add your rows to the existing `INSERT` statements rather than writing a new
one: a short comment above your own lines saying what you added and when is
the house style, so the next person can see why a row is there without asking.

## Step 4: apply it, and prove the meter picked it up

Both files are safe to reload; every statement in them is idempotent.

    docker exec -i postgres psql -U postgres -d kids_network < config/db/schema-categories.sql
    docker exec -i postgres psql -U postgres -d kids_network < config/db/schema-services.sql

Then run `bash test/schema-test.sh`. It builds a fresh database from every
schema file in order and checks the domain map still loads and is still
seeded; it must pass before you go further.

Proving it actually works end to end takes patience, because the meter only
learns from real traffic:

1. Have the child use the service for a few minutes, for real, on a device
   Genkan already knows.
2. Run `kidnet-catmap` (or wait for `kids-services.timer`), then check the
   address was learned:

       docker exec -i postgres psql -U postgres -d kids_network -c \
         "SELECT * FROM category_ips WHERE seen > now() - interval '10 minutes'"

3. Check the firewall picked the address up, and check minutes are actually
   being booked. docs/OPERATIONS.md's **"Is the metering chain actually
   learning?"** section walks through all four links in this chain in the
   right order, with the exact commands, and is the one to follow if step 2
   comes back empty.

If the domain never appears in `category_ips` at all, re-read the ambiguity
guard in `bin/kidnet-catmap`: the address may have answered for more than one
category in the same window, in which case it is being correctly refused, not
missed.

## Step 5: send it back

The map is exactly as good as the households who extend it, and a family in a
country nobody here has lived in is in the best position to get this right.

1. Fork [github.com/0800tim/genkan](https://github.com/0800tim/genkan).
2. Add your rows to `config/db/schema-categories.sql` and, if you want the
   service named rather than just categorised, `config/db/schema-services.sql`.
3. Run `bash test/schema-test.sh` and confirm it passes.
4. Open a pull request. Say which service, which country, and which domains
   you checked with `getent`. If you deliberately left a CDN hostname out
   because it turned out to be shared, say that too: it saves the next
   contributor from trying the same domain and hitting the same wall.

No commercial content, no telemetry, no account or password of yours is ever
needed to do any of this: every domain here is public, and the only thing that
proves the work is your own house's DNS log.
