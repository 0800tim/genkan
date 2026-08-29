# Tor, darknet and serious content: the DNS layer

Companion to `blocklists.md` (which lists to enable) and INTEGRATION.md
(how rules are pushed). This file covers the layer AdGuard contributes to
Tor/darknet blocking and to the genuinely serious categories, and how each
domain maps to the `flag_domains` alert table (config/db/schema-flags.sql).

Division of labour, one line: **nftables blocks the Tor network itself**
(the `tor_nodes` IP set, fed by `bin/kidnet-tor-sync`); **AdGuard blocks
the on-ramps** (downloads, bridges, onion gateways, directories) and gives
us the DNS lookups that drive the alerts. Neither layer is complete alone.

## a. Tor on-ramps: block AND portal-redirect

These are rendered by `bin/kidnet-adguard` as one `$client=<child name>`
dnsrewrite rule per child, pointed at the portal address, so a kid who tries
them gets the warm "come talk to me" page (docs/tor-and-safety.md has the
copy), not a silent NXDOMAIN. `.onion` patterns are excluded from the render,
since there is nothing to redirect. Every one of them also raises an alert on
the query-log ingestion pass, via `bin/kidnet-alerts`.

Self-harm patterns are deliberately NOT rendered here. That category is
alert-only by policy and must never route a child to any blocking page.

| Domain | What it is | flag_domains |
|---|---|---|
| `torproject.org` (apex, covers all subdomains) | Tor Browser download, docs | tor / warn (seeded) |
| `bridges.torproject.org` | bridge handout, only reason to visit is evading a block | tor / urgent (seeded) |
| `snowflake.torproject.org` | Snowflake pluggable transport | tor / urgent (seeded) |
| `dist.torproject.org` | download mirror | tor / warn (seeded) |
| `tor.eff.org` | historic mirror alias | tor / warn (add) |

Honest limit: Tor Browser is also distributed through GitHub releases and
the GetTor email autoresponder, and we are not blocking GitHub over it.
Blocking the front door plus alerting on the attempt is the design, not a
claim of a sealed exit.

## b. Onion gateways (tor2web): the clearnet route INTO the darknet

These proxies serve `.onion` sites to an ordinary browser with no Tor
install at all, which makes them the single most kid-reachable path to
darknet content. Block the apex domains; a lookup is a strong signal, so
they are urgent in flag_domains. Many tor2web operators come and go;
blocking a dead one costs nothing, so keep the list generous:

`onion.to`, `onion.ws`, `onion.pet`, `onion.ly`, `onion.sh`, `onion.top`,
`onion.city`, `onion.cab`, `onion.direct`, `onion.plus`, `tor2web.org`,
`tor2web.io`, `tor2web.fi`

Category `darknet`, severity `urgent`, note "onion gateway (darknet via
plain browser)". Also flag the literal suffix `.onion` itself: those names
never resolve on the public DNS (RFC 7686), so a `.onion` query reaching
our resolver means a device is trying to reach a hidden service without a
working Tor tunnel. Pure signal, nothing to block, alert only.

## c. Darknet directories and market indexes (clearnet)

Kids find markets via clearnet directories first. Block and portal-redirect;
all urgent:

| Domain | flag_domains |
|---|---|
| `dark.fail` | drugs / urgent (seeded) |
| `tor.taxi` | drugs / urgent (seeded) |
| `onion.live` | darknet / urgent (seeded) |
| `darknetlive.com` | darknet / urgent (seeded) |
| `daunt.link` | darknet / urgent (seeded) |

All of the below is now seeded in `config/db/schema-flags.sql`, in a second
additive INSERT so re-running the file never rewrites a hand-tuned severity.
Kept here as the payload of record:

```sql
INSERT INTO flag_domains(pattern, category, severity, note) VALUES
 ('tor.eff.org','tor','warn','Tor mirror alias'),
 ('.onion','darknet','urgent','.onion query leaked to our resolver (Tor attempt)'),
 ('onion.to','darknet','urgent','onion gateway (darknet via plain browser)'),
 ('onion.ws','darknet','urgent','onion gateway'),
 ('onion.pet','darknet','urgent','onion gateway'),
 ('onion.ly','darknet','urgent','onion gateway'),
 ('onion.sh','darknet','urgent','onion gateway'),
 ('onion.top','darknet','urgent','onion gateway'),
 ('onion.city','darknet','urgent','onion gateway'),
 ('onion.cab','darknet','urgent','onion gateway'),
 ('onion.direct','darknet','urgent','onion gateway'),
 ('onion.plus','darknet','urgent','onion gateway'),
 ('tor2web.org','darknet','urgent','onion gateway project site'),
 ('tor2web.io','darknet','urgent','onion gateway'),
 ('onion.live','darknet','urgent','darknet market directory'),
 ('darknetlive.com','darknet','urgent','darknet news and market directory'),
 ('daunt.link','darknet','urgent','darknet link directory')
ON CONFLICT (pattern) DO NOTHING;
```

Caution on `.onion` and short patterns generally: flag_domains matches as a
suffix with `ILIKE '%'||pattern`, so `.onion` is safe (it can only match
the TLD) but never add a pattern like `onion` bare; it would match
`funonion.com`.

## d. Which enabled lists already help

- **HaGeZi DoH/VPN/Proxy Bypass** (enabled): covers many web proxies and
  VPN endpoints that are the sibling bypass to Tor. Backs up the nftables
  DoH set.
- **HaGeZi TIF medium** (enabled): threat intelligence; catches the scam
  and malware end of darknet-adjacent sites, plus many freshly registered
  mirror domains.
- **OISD NSFW** (enabled): the extreme-pornography overlap.

There is no reputable maintained public list dedicated to "darknet
directories" or "Tor on-ramps"; the curated set above is small on purpose
and lives in our database where the alert table can see it. HaGeZi also
publishes an **Ultimate/Multi** tier with broader "anonymiser" coverage;
worth revisiting if the curated set starts missing things, at the cost of
more false positives on privacy tools adults may legitimately use.

## e. Extreme and illegal content: what is honestly covered by what

- **Extreme violence / gore shock sites**: no well-maintained free
  standalone list exists (the old ones are abandoned). Coverage: the
  parental web service (`parental_enabled`) for the young and standard
  tiers, OISD NSFW for the pornographic end, TIF for the malware-laced
  end, and a small curated set in the database (same mechanism as weapons
  in blocklists.md). Alert category `extreme`, severity `urgent`.
- **Pro-self-harm**: alert, never blanket-block; help lines pinned open.
  Already policy (blocklists.md, RECOMMENDATIONS section 6). The seeded
  `sanctioned-suicide` pattern is the shape: name specific harmful sites,
  never keywords.
- **CSAM**: handled upstream, and deliberately NOT by this repo's lists or
  captive portal. There is no public CSAM blocklist and there must not be:
  such a list would itself be an index of the material. The blocking that
  exists lives with the resolver services and national infrastructure: our
  Quad9 upstream and AdGuard's Safe Browsing / family services carry abuse
  feeds, and in NZ the DIA's Digital Child Exploitation Filtering System
  runs at ISP level. If anything in this area is ever actually
  encountered, that is a police / DIA (report at dia.govt.nz) / Netsafe
  matter, full stop. It is not a warm-portal conversation and it is not a
  category we tune. The portal message and flag_domains never reference
  this category; the design boundary is deliberate.

## f. How the alert pipeline uses all this

The query-log ingestion pass (INTEGRATION.md section c) already matches
`question.name` against `flag_domains` by suffix. Everything this file
adds rides that existing rail: block at DNS (portal rewrite), flag on
lookup, alert to the dashboard at the row's severity. Urgent rows page
the parent; warn rows appear in the daily picture. The alert is a
conversation prompt, not a verdict: the seeded notes say why each pattern
matters so the parent walks over informed, not alarmed.

The nftables half (the `tor_nodes` set and `tor_dev` attempt counters)
catches the case DNS never sees: a Tor client with hardcoded relay IPs.
Design in docs/tor-and-safety.md.
