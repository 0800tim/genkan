# kids-network

Infrastructure-as-code for the kids' network island: a separate
wired+wireless segment where clawdia is the sole gateway, so internet
on/off (per kid, or all), DNS safety filtering, and per-device logging
are things clawdia owns and the agent can drive from Tim's phone.

**Read PLAN.md first** for the full design, topology, and the honest
limits of network-level monitoring.

## Containerised: the island cannot touch the house

Everything island-facing runs in Docker (compose.yaml). The gateway
container owns its own network namespace holding exactly two interfaces:
eth0 (ordinary docker uplink) and kids0 (the physical USB NIC, handed in
by the host warden). The firewall, DHCP+DNS (AdGuard) and the kid portal
all live inside that namespace with NET_ADMIN+NET_RAW only: a bad rule can
degrade the island, never the house. Postgres holds desired state; the
gateway reconciles the firewall from it every 15 seconds.

Two safety properties worth knowing:
- Segment guard: on every NIC (re)appearance the gateway listens on the
  wire first. Another DHCP server or foreign-subnet traffic means the
  island refuses to start and raises an urgent alert. Fail closed: if it
  cannot listen, it does not start.
- Fail-closed worst case: if the box or container dies, the kids' island
  goes down; the main house network is untouched either way.

| Piece | Where it runs |
|---|---|
| firewall config/nftables/kids.nft | inside the gateway container |
| DHCP + DNS + filtering (config/adguard/) | adguard container, same netns |
| kid portal + learn-to-earn (dashboard/portal.mjs) | portal container, same netns, island :80 |
| admin dashboard (dashboard/server.mjs) | HOST systemd --user, tailnet :8899 |

The dashboard is tailnet-only by default. For an extra layer, set `DASH_TOKEN`
in its unit's `Environment=`: every control call then requires that secret,
injected via a same-origin cookie so the operator never types it.
| bin/kidnet, bin/kidnet-meter | host CLI (drives nft via docker exec) |
| host/kids-nic-warden.{sh,service} | host systemd, the only host-side piece |

`sudo ./deploy.sh` validates the ruleset, builds the image, installs the
host pieces and starts the stack.

## Layers (see PLAN.md for detail)

1. `kids0` (USB ASIX AX88179) = 192.168.60.1/24, the kids' gateway.
2. NAT: nftables masquerade 192.168.60.0/24 -> enp5s0.
3. DHCP + DNS + filtering: AdGuard Home (per-device logs, category
   blocklists, SafeSearch). DHCP hands out .60.1 as gw+DNS.
4. On/off: `kidnet off|on Ben|Cleo|all`, backed by an nftables set.
5. Schedules: systemd timers calling kidnet (bedtime off, morning on).
6. Safety net: `kidnet allow-sync` resolves the `always_allow` domains with
   `scope='safety'` into the nft set `@kids_allow`, so the NZ youth help lines
   and schoolwork stay reachable through a cut, dinner, bedtime and running
   out of time. Refreshed hourly, because those addresses move.

## Learn-to-earn

Kids earn minutes by learning. Quiz banks live in portal/quizzes/ (static
JSON, PRs welcome; see FORMAT.md), graded server-side with cooldowns and a
daily cap. Chores are claims a parent approves on the dashboard. See
docs/runbooks/ for how other families' agents can generate curriculum
banks for their own country, and docs/AGENT.md for the voice interface.

## Tests

Two rigs, both required green before any commit that touches the network:
- `sudo test/firewall-test.sh`: the ruleset alone, three throwaway netns,
  20 packet-level checks.
- `sudo test/container-test.sh`: the real image with the real capabilities,
  25 checks: containment (nothing of ours on the host), island function,
  USB replug resilience, and the segment guard refusing a poisoned wire.

## Status

Planning + scaffolding done (2026-08-27). NOT deployed. Waiting on the
physical build: spare switch + cabling, and Deco X20 flipped to AP mode.
Adapter detected: kids0 = ASIX AX88179 (mac <your-adapter-MAC>).

## Not solved here

- Son's mobile data: cellular never touches this network. Google Family
  Link only. See PLAN.md.
- In-app bullying (Snapchat/Insta/Discord DMs): end-to-end encrypted,
  invisible to the network. Needs a consenting app tool (e.g. Bark).

## Admin dashboard

`dashboard/` is a small Node service (systemd user unit
`kids-dashboard.service`) on the tailnet at http://<your-box-ip>:8899.
Mobile first, because it is driven from a phone. Three views:

| View | What it is for |
|---|---|
| Tonight (`/`) | State now and the controls: internet off/on per kid, kill gaming, media, study mode, Dinner/family pause, bonus minutes, chore approvals |
| Trends (`/trends?days=7\|30`) | Per kid: where the time went day by day, losing time against gaining time, and which services, with a table twin under every chart |
| Devices (`/devices`) | The roster by class (personal / smart home / infrastructure) and the naming queue for new devices |

Buttons call `bin/kidnet`; state is in Postgres (`kids_network`). The charts
are self-contained inline SVG with no library and no CDN, so the dashboard
works with the house internet down. `dashboard/analytics.mjs` holds the
read-only queries, `charts.mjs` the SVG, `views.mjs` the pages.

**On honesty.** The Trends view labels what each number is. DNS lookups are
lookups: a proxy for activity, never data volume and never minutes. Minutes
come from the meter (`category_usage`), bytes only from the real nftables
per-service counters (`service_usage`), and nothing is ever derived from a
lookup count. Anything the gateway cannot attribute to a child is reported as
unattributed rather than spread around. See METERING.md for the limits.

## More docs

- PLAN.md - full build design + topology + honest limits
- RECOMMENDATIONS.md - age-tiered policy (11/14/16), tamper resistance,
  guest isolation, safety net, and the things worth doing beyond on/off
- PRIOR-ART.md - similar OSS + how this differs + unrot kinship
- BUG-BOUNTY.md - household bug-bounty house rules (turn bypass attempts into learning)

## Who made this, and why

I am Tim Thomas, and I have three kids, aged 11, 14 and 16.

This started the way most of these things start. The screens were winning. Not
in a dramatic way, just the ordinary grind: the endless scroll, one more round,
the argument at dinner. I went looking for something to help and did not like
what I found. The good parental-control services want a subscription and, in
return, a copy of everywhere your children go on the internet. The router apps
are clumsy and treat every child the same. Almost all of it is built to watch
kids rather than to help them.

So I built the thing I actually wanted: a box by the router that belongs to me,
where the filtering is mine, the logs never leave the house, and my kids can
earn their screen time by learning something rather than begging for it. It
runs on my own family first. Every decision in here was made under the pressure
of three real children who are smarter than the software and quite willing to
prove it, which is why there is a bug bounty in the repo rather than a pretence
that they cannot beat it.

There is nothing to buy, and no company behind it looking for a return. It is
MIT licensed because a tool that shapes how children use the internet should
not depend on anyone's subscription staying current, and because the only
honest answer to "how do I know you are not monetising my kids' browsing" is:
read the code, it runs on your hardware, and it never sends anything anywhere.

### Help me build it

I would genuinely like company on this. It is a family problem dressed up as a
networking problem, and it will get better fastest with people who know things
I do not.

Particularly welcome:

- **Parents who self-host.** You already run things at home. Try it, tell me
  where it is annoying, tell me what your kids did to get around it.
- **Linux and distro people.** It is Docker and standard tooling underneath, so
  it should run anywhere. Packaging, hardening and making the setup less fiddly
  are all wide open.
- **Teachers and tutors.** The quiz banks that kids earn time from are plain
  JSON files. If you know how to teach a subject well, a good bank is worth
  more than any feature I could write.
- **Anyone who can break it.** Especially the filter bypasses. Found one? Open
  an issue. That is the whole spirit of the household bug bounty, scaled up.

Start with CONTRIBUTING.md, or just open an issue and say hello.

Sibling project: [unrot](https://github.com/0800tim/unrot), earn screen time by
learning.
