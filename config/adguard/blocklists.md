# Blocklists: which lists, per category, and why

Companion to `AdGuardHome.yaml`. That file enables the lists marked
**enabled** below; the rest are documented alternatives.

## The one AdGuard Home limitation that shapes everything

Filter lists in AdGuard Home are **global**. There is no per-client list
assignment. What CAN differ per client is: filtering on/off, SafeSearch,
Safe Browsing, the parental web service, blocked services, and custom rules
scoped with `$client` or `$ctag`.

So the global list set is the union of what the strictest tier needs, chosen
so the overlap is defensible for everyone on the island:

- Adult, malware and VPN-bypass blocked for all: correct for every tier
  including guest.
- Gambling blocked for all: fine for the kids (all under 18) and acceptable
  for guests on a kids' network. If a household objects, disable the gambling
  list; nothing else depends on it.
- Categories that only the younger tiers need (social media for the 11 year
  old, dating apps) are done with per-client **blocked services**, not lists,
  so they never touch the teen or guests.

## Enabled lists (in AdGuardHome.yaml)

| Category | List | URL | Why this one |
|---|---|---|---|
| ads, trackers | AdGuard DNS filter | `https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt` | AdGuard's own default; built for DNS blocking, very low false positives. |
| adult | OISD NSFW | `https://nsfw.oisd.nl` | Actively maintained, aggregated from many sources, deduplicated, and OISD's whole reputation is built on not breaking legitimate sites. Also covers a fair share of hookup and cam sites. |
| malware, phishing, scam | HaGeZi TIF medium | `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.medium.txt` | The medium cut of HaGeZi's Threat Intelligence Feeds: strong protection without the full list's size or its higher false-positive tail. Quad9 upstream adds a second, independent malware layer. |
| gambling | HaGeZi Gambling | `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt` | Large and current, covers offshore casinos and the skin-betting sites kids actually find. |
| proxy-vpn, DoH bypass | HaGeZi DoH/VPN/Proxy Bypass | `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/doh-vpn-proxy-bypass.txt` | Blocks public DoH resolvers, VPN providers and web proxies at the DNS layer. Backs up the nftables rules that force DNS through the gateway (RECOMMENDATIONS section 3). Covers the easy 90 percent of bypasses; a determined teen is bug-bounty territory. |

## Categories deliberately NOT covered by a list, and what we do instead

Honesty over checkbox coverage. There is no well-maintained free list for
these, and pretending otherwise gives false confidence:

- **drugs**: no reputable, maintained, free standalone list exists. Coverage
  comes from: the parental web service (`parental_enabled`, on for the young
  and standard tiers, backed by AdGuard's family service), the TIF list for
  the scammy end of the market, and a small curated `$ctag`/`$client` rule
  set that kidnet renders from our own database categories.
- **self-harm**: worse than unlisted, blunt blocking here is actively
  dangerous, because the same keywords sit on the help sites. Policy per
  RECOMMENDATIONS section 6: do not blanket-block, ALERT instead. The query
  log ingestion flags self-harm related lookups as URGENT, and the NZ help
  lines are pinned open with `$important` allow rules whatever else happens.
- **dating**: no maintained free list. Handled per tier with blocked
  services (`tinder`, `grindr`, `plenty_of_fish` are valid service ids) plus
  the OISD NSFW overlap for the seedier end. This is the right shape anyway:
  dating apps are a per-age call, not a whole-island one.
- **weapons**: no maintained free list. Small curated domain set in the
  database, rendered by kidnet as custom rules for the young tier only.
  Accept that coverage is thin; weapons content for an NZ 11 year old is
  mostly a YouTube problem, which restricted mode handles better.

## Alternatives considered

| List | Verdict |
|---|---|
| HaGeZi NSFW (`adblock/nsfw.txt`) | Bigger than OISD NSFW, catches more, but with a higher false-positive rate (art platforms, lingerie retail). Swap in if OISD misses things you care about. |
| StevenBlack `fakenews-gambling-porn` | One combined hosts file, widely used, but you cannot take just one category, its porn and gambling components (Sinfonietta's lists) update slowly, and the bundled fakenews category is not a call we want a list making for the kids. |
| Sinfonietta `pornography-hosts` / `gambling-hosts` | The standalone components StevenBlack bundles. Fine, but less actively curated than OISD and HaGeZi; kept as fallbacks. |
| OISD big (`https://big.oisd.nl`) | Excellent general list (ads plus malware) but overlaps AdGuard DNS filter and TIF heavily. Adds memory for little gain here. |
| HaGeZi TIF full (`adblock/tif.txt`) | Maximum threat coverage, roughly ten times the size, more false positives on freshly registered but legitimate domains. Medium is the better default for a family. |
| HaGeZi Multi PRO (`adblock/pro.txt`) | Stronger ad and tracker blocking than the AdGuard DNS filter, slightly higher breakage (some login and payment flows). Reasonable upgrade once the island is stable. |

## Per-tier picture (lists plus the per-client layers)

| Layer | young (11) | standard (14) | teen (16) | guest |
|---|---|---|---|---|
| Global lists (adult, malware, gambling, proxy-vpn, ads) | yes | yes | yes | yes |
| Safe Browsing service | on | on | on | on |
| Parental web service | on | on | off | off |
| SafeSearch forced (Google, Bing, DDG, YouTube restricted) | on | on | off | off |
| Blocked services | social media, dating, adult platforms | dating, adult platforms, 4chan | dating apps, OnlyFans | none |
| Query logging | on | on | on | **off** (no logging of guests) |
| Custom `$client` rules from kidnet (category blocks, portal) | yes | yes | yes | no |

## False-positive playbook

When something legitimate breaks, in order:

1. Check which rule fired: Query Log shows the rule and list per blocked
   query, or `GET /control/filtering/check_host?name=example.com`.
2. If it should be open for everyone, add `@@||example.com^` to the
   database allowlist so kidnet renders it into the user rules. Use
   `$important` only for the safety-net domains that must beat everything.
3. If it is one list misfiring repeatedly, swap that list for its gentler
   variant (TIF medium is already the gentle cut; OISD NSFW rarely misfires).
4. Do not disable a whole category to fix one site.

Lists refresh every 24 hours (`filters_update_interval: 24`). All five
enabled URLs were checked reachable on 2026-08-29.
