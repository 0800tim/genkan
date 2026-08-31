# How kidnet drives AdGuard Home at runtime

Verified against AdGuard Home **v0.107.79** (current stable, 2026-08-18,
config `schema_version: 34`), from the official OpenAPI spec and wiki. Pin
the container image to `adguard/adguardhome:v0.107.79`; re-verify this
document before bumping.

Division of labour: `AdGuardHome.yaml` is the first-boot seed only. AdGuard
rewrites that file itself (and strips every comment) once anything changes,
so ALL runtime changes go through the REST API. kidnet stays the brain; the
database stays the source of truth; AdGuard is the DNS enforcement plane
(nftables is the IP enforcement plane).

## Base URL and authentication

Everything lives under `http://192.168.60.1:3000/control`. Reach it from
the Genkan box itself or the main LAN; nftables blocks the kids' subnet from port
3000.

Two auth options; kidnet uses the first:

1. **HTTP basic auth on every request** (stateless, no session to expire):

   ```sh
   . /etc/kids-network/secrets.env   # AGH_USER, AGH_PASS
   curl -fsS -u "$AGH_USER:$AGH_PASS" http://192.168.60.1:3000/control/status
   ```

2. Session cookie: `POST /control/login` with `{"name":..,"password":..}`
   sets an `agh_session` cookie honoured for `http.session_ttl` (720h).

## a. Per-client blocked services (category kill per kid)

Endpoints: `GET /control/clients`, `POST /control/clients/update`,
plus `/control/clients/add` and `/control/clients/delete`.

Two traps:

- **Update replaces the whole client object.** Always GET first, mutate the
  one field, POST the full object back. Omitted booleans fall back to
  defaults, not to the stored value (except `ignore_querylog` and
  `ignore_statistics`, which keep their stored value when omitted).
- **The API shape differs from the YAML shape.** In the API, `blocked_services`
  is a flat array of service ids and the schedule is a separate
  `blocked_services_schedule` object. In the YAML file it is one object with
  `ids` and `schedule` nested. Do not copy YAML shapes into API calls.

Block TikTok and Roblox for child-14 (fetch, then update):

```sh
curl -fsS -u "$AGH_USER:$AGH_PASS" http://192.168.60.1:3000/control/clients \
  | jq '.clients[] | select(.name=="child-14")'

curl -fsS -u "$AGH_USER:$AGH_PASS" \
  -H 'Content-Type: application/json' \
  -X POST http://192.168.60.1:3000/control/clients/update \
  -d '{
    "name": "child-14",
    "data": {
      "name": "child-14",
      "ids": ["192.168.60.111", "192.168.60.112"],
      "tags": ["user_child"],
      "use_global_settings": false,
      "filtering_enabled": true,
      "safebrowsing_enabled": true,
      "parental_enabled": true,
      "safe_search": {"enabled": true, "bing": true, "duckduckgo": true,
        "ecosia": true, "google": true, "pixabay": true, "yandex": true,
        "youtube": true},
      "use_global_blocked_services": false,
      "blocked_services": ["4chan", "onlyfans", "tinder", "grindr",
        "tiktok", "roblox"],
      "ignore_querylog": false,
      "ignore_statistics": false
    }
  }'
```

Valid service ids come from `GET /control/blocked_services/all` (139 ids at
time of writing; `roblox`, `steam`, `epic_games`, `minecraft`, `playstation`,
`xboxlive`, `nintendo`, `tiktok`, `youtube`, `discord`, `twitch`, `netflix`
all exist; there is no `fortnite`, use `epic_games`). Note "gaming off" needs
the nftables IP-set drop as well (METERING.md): DNS blocking alone does not
kill an already-resolved connection.

Client matching: an exact-IP client entry beats the guest `192.168.60.0/24`
subnet entry, so kid devices must keep DHCP reservations. Reservations are
added at deploy time (MACs are household-specific, never committed):

```sh
curl -fsS -u "$AGH_USER:$AGH_PASS" \
  -H 'Content-Type: application/json' \
  -X POST http://192.168.60.1:3000/control/dhcp/add_static_lease \
  -d '{"mac": "aa:bb:cc:dd:ee:ff", "ip": "192.168.60.111", "hostname": "child-14-phone"}'
```

## b. Custom filtering rules (portal redirect, per-category blocks)

Endpoint: `POST /control/filtering/set_rules` with `{"rules": [...]}`.

**It replaces the entire custom rule list.** kidnet must therefore render
the complete set from the database on every change: safety allows first,
then active blocks and redirects. Never append blindly; read-modify-write is
also wrong if two writers exist. One renderer, one writer.

Rule grammar (AdGuard Home DNS flavour):

```
# Send EVERY domain for one device to the portal (kid out of time).
# Regex catch-all, scoped to the client, answered with the gateway IP.
/.*/$client=192.168.60.111,dnsrewrite=NOERROR;A;192.168.60.1

# Answer one domain with the portal for one client (single-category block
# where we want the "time's up" page, not a dead connection).
||roblox.com^$client=192.168.60.111,dnsrewrite=NOERROR;A;192.168.60.1

# Plain per-client block (null-IP answer, no portal).
||roblox.com^$client=192.168.60.111

# Same rule for several devices.
||roblox.com^$client=192.168.60.111|192.168.60.112

# Tag-scoped rule: hits every client whose tags include user_child.
||example-bad.site^$ctag=user_child
```

The short form `dnsrewrite=192.168.60.1` also works; the explicit
`NOERROR;A;192.168.60.1` form is preferred because it leaves AAAA queries
unanswered rather than ambiguous.

Full render for "child-14 is out of time" (safety exceptions must be in the
same payload, since the list is replaced wholesale):

```sh
curl -fsS -u "$AGH_USER:$AGH_PASS" \
  -H 'Content-Type: application/json' \
  -X POST http://192.168.60.1:3000/control/filtering/set_rules \
  -d '{
    "rules": [
      "@@||1737.org.nz^$important",
      "@@||1737.org.nz^$dnsrewrite",
      "@@||youthline.co.nz^$important",
      "@@||youthline.co.nz^$dnsrewrite",
      "@@||kidsline.org.nz^$important",
      "@@||kidsline.org.nz^$dnsrewrite",
      "@@||thelowdown.co.nz^$important",
      "@@||thelowdown.co.nz^$dnsrewrite",
      "/.*/$client=192.168.60.111,dnsrewrite=NOERROR;A;192.168.60.1",
      "/.*/$client=192.168.60.112,dnsrewrite=NOERROR;A;192.168.60.1"
    ]
  }'
```

To verify what a given client would get for a domain:
`GET /control/filtering/check_host?name=roblox.com&client=192.168.60.111`.

## c. Reading the query log (dns_log ingestion)

Endpoint: `GET /control/querylog`. Parameters: `limit`, `older_than`
(pagination cursor), `offset` (alternative to `older_than`; pick one),
`search` (domain or client IP), `reason` (filter by filtering reason).

```sh
# Newest 500 entries.
curl -fsS -u "$AGH_USER:$AGH_PASS" \
  'http://192.168.60.1:3000/control/querylog?limit=500'

# Next page: pass the previous response's "oldest" value.
curl -fsS -u "$AGH_USER:$AGH_PASS" \
  --get --data-urlencode "older_than=2026-08-29T10:15:04.123456789+12:00" \
  --data-urlencode "limit=500" \
  'http://192.168.60.1:3000/control/querylog'

# Only one kid's device.
curl -fsS -u "$AGH_USER:$AGH_PASS" \
  'http://192.168.60.1:3000/control/querylog?search=192.168.60.111&limit=200'
```

Response: `{"oldest": "<timestamp>", "data": [items]}`. Each item carries
`time`, `client` (IP), `question.name` and `question.type`, `reason`
(`NotFilteredNotFound` for allowed, `FilteredBlackList` for list-blocked,
`FilteredSafeSearch`, `Rewritten`/`RewrittenRule`, etc.), `rules` (which
rule and list fired), `elapsedMs`, `upstream`, and `answer`.

Ingestion pattern for kidnet: poll every 30 to 60 seconds with `limit=1000`,
walk pages via `older_than` until reaching the last ingested timestamp,
dedupe on `(time, client, question.name, question.type)`. Guest devices do
not appear at all (`ignore_querylog: true` on the guest client), which is
the intended "no logging of persons" behaviour. The self-harm URGENT alert
(RECOMMENDATIONS section 6) is a match on `question.name` during this same
ingestion pass, which is why that category is alert-not-block.

The log window is set in `querylog.interval` (720h, 30 days). AdGuard prunes
older entries itself; the database keeps only what our reports need.

## d. When a kid is blocked: captive portal behaviour

Goal: a blocked kid sees the friendly portal page, an allowed kid never
does, and no device sulks in a broken half-online state.

1. **Blocked kid**: kidnet renders the catch-all redirect rule for each of
   the kid's IPs (section b). Every A query, including the OS
   captive-portal probe domains, now answers `192.168.60.1`:
   `connectivitycheck.gstatic.com` and `connectivitycheck.android.com`
   (Android), `captive.apple.com` (Apple), `www.msftconnecttest.com`
   (Windows), `detectportal.firefox.com` (Firefox), `nmcheck.gnome.org`
   (Linux). The probe then does an HTTP GET against the portal on port 80,
   gets our page instead of the expected 204 or `success` body, and the OS
   pops the sign-in sheet showing portal.mjs. No probe-domain special-casing
   is needed; the catch-all covers them.
2. **Belt and braces on port 80**: nftables also DNATs the blocked IPs'
   `:80` to `192.168.60.1:80`, catching devices with a cached DNS answer.
   HTTPS connections just fail (we do not intercept TLS, PLAN.md is explicit
   about that); the portal popping via the probe is what keeps the failure
   friendly.
3. **Allowed kid**: no rule matches their IP, probes resolve normally and
   return 204, so no false portal sheet. This is why portal redirection is
   done per client with `$client` rules and NOT with global rewrites or
   `blocking_mode: custom_ip`.
4. **Safety net**: the `$important` plus `$dnsrewrite` exception pairs ride
   in the same rule set, so the help lines resolve normally even while the
   catch-all is active, and the nftables `kids_allow` set lets the actual
   TCP flows through (firewall-test.sh proves that half).
5. **Restore**: re-render the rule set without the kid's redirect rules and
   POST it; the `blocked_response_ttl: 10` and short client-side TTLs mean
   recovery within seconds. `POST /control/cache_clear` forces AdGuard's own
   cache clear if needed.

## How always_allow wins over everything

Two different mechanisms, and the precedence between them matters:

**Filtering rules** (blocklists and user rules) resolve in this order:

1. `@@||domain^` (plain exception) beats normal blocklist rules.
2. `||domain^$important` (important block) beats a plain exception.
3. `@@||domain^$important` (important exception) beats everything above,
   including important blocks from any list.

So every `always_allow` domain with `scope=safety` is rendered as
`@@||domain^$important`: no list we subscribe to, and no block rule kidnet
itself writes, can override it. `scope=category` domains (Spotify etc.) are
rendered as plain `@@||domain^` so a deliberate full cut still beats them.

**DNS rewrites are outside that ladder.** A `dnsrewrite` rule is not a
block, so a plain `@@` or `$important` exception does not cancel it; the
cancelling exception must itself carry the `$dnsrewrite` modifier:
`@@||domain^$dnsrewrite` (unscopes all rewrites for that domain). That is
why every safety domain gets BOTH rules: `$important` to beat the
blocklists, `$dnsrewrite` to beat the portal catch-all.

**Legacy rewrites** (`filtering.rewrites` in YAML, `/control/rewrite/list`,
`/rewrite/add`, `/rewrite/update`, `/rewrite/delete` in the API) are a third
mechanism again: global, not per-client, and not cancelled by allowlist
rules. `$dnsrewrite` rules take precedence over them. We use legacy rewrites
only for stable infrastructure names (`genkan.home`, `portal.genkan.home`)
and never for policy, precisely so allowlist reasoning stays in one place.

## Version caveats and deliberate omissions

- Everything above was checked against the v0.107.79 OpenAPI spec and the
  official wiki on 2026-08-29. The YAML seed parses as schema 34.
- The wiki documents these tag values for clients; custom tag strings are
  not part of the documented set, so we only use `user_child` and
  `user_regular` and keep real grouping in our own database.
- Left OUT of the YAML on purpose (defaults are fine, or the key was not
  worth the risk): `dns.fallback_dns`, `dns.ratelimit*`,
  `dns.local_ptr_upstreams`, `dhcp.dhcpv4.options` (AdGuard already offers
  itself as DNS and `gateway_ip` as router, so explicit options 3 and 6 are
  redundant), `tls` (disabled by default), `dns.enable_dnssec` (Quad9
  validates upstream). AdGuard fills all of these with defaults on first
  boot.
- The querylog `older_than` cursor format follows the response's `oldest`
  field; treat it as opaque and echo it back rather than constructing it.
- `POST /control/filtering/refresh` (body `{"whitelist": false}`) forces a
  list update outside the 24 hour cycle, useful after editing the filter
  set.
- AdGuard Home does not support per-client filter lists; see blocklists.md
  for how the tiers are expressed instead. If that feature lands in a later
  release, revisit the union-list compromise.
