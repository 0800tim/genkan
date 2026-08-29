# Security: what is fixed, what is open

Hearth ships its own adversarial audits in `research/`, which is unusual and
deliberate. The cost of that honesty is that a reader, human or AI, can quote a
finding without checking whether it is still true. That has already happened:
an external reviewer read the reports and told a parent to fix the DNS-log
poisoning before trusting Hearth, hours after it had been fixed.

**This file is the answer to "is that still a problem".** It is checked against
the code, not against the reports.

## Fixed

| Finding | Severity | Fixed in | What changed |
|---|---|---|---|
| SQL injection reachable from the dashboard API (`topsites`, `recent` limits) | Critical | `83d59f0` | `ck_int` on both limits, plus an API-layer guard rejecting any control argument that is not a plain name, number or short label. Proven exploitable over HTTP before the fix, and refused after. |
| DNS-log poisoning silently stopping every safety alert | High | `4484488` | The ingest writes real CSV rather than COPY's text format, which has no backslash grammar to poison. A failed ingest now raises an urgent alert and exits non-zero instead of failing silently, because silence was the real damage. |
| `tools/publish.sh` printing a clean board when its checks had not run | High | `a3a5b7c` and later | The two most valuable checks failed open when the database did not answer or the author name was unset. They now report a leak, because that is the safe reading. It also refuses unscannable binaries, and `--check` scans without publishing. |
| Portal `?kid=` override readable by any device on the island | Low | `e35a515` | Needs a preview token the dashboard holds, or the demo flag. |
| Test suites passing without running (missing netcat) | High | `1997b26`, `30f5be2` | Eleven isolation assertions passed on any machine without netcat, including every default Arch install. All probes moved to bash's own TCP support, and a probe that cannot run is now a hard failure. |
| IoT vendor learning storing nothing while reporting success | High | `61c99f1` | The camera lockdown had never actually been in force. |

## Open, and honestly so

| Finding | Severity | Status |
|---|---|---|
| `kids_known` is fed by DHCP leases | High | Real. A device that gets a lease is known. Device claiming closes it (`docs/DEVICE-IDENTITY.md`) but **ships off by default**, so it is open until a household turns it on. That default is deliberate: switching it on changes what happens to every unrecognised device, and a family should choose that rather than inherit it from an update. |
| `bin/kidnet` connects to Postgres as a superuser | High | Being fixed. Every CLI operation currently runs as `postgres` on a shared instance, which turns any injection into a whole-server problem. |
| Remaining ungated interpolations in CLI-only paths | Medium | Being fixed. The HTTP-reachable ones are closed; several operator-only paths still interpolate without a gate. |
| `DASH_TOKEN` handed to any unauthenticated GET | Medium | By design, and weaker than its comment claimed. It buys CSRF protection, not a perimeter. The perimeter is the private network the dashboard binds to. Do not expose the dashboard publicly without putting real authentication in front of it. |
| `tor_nodes` empty on a live gateway | Medium | The Tor blocklist syncs from a timer that is installed but was not running here. The test suite passes because it injects its own elements, which is the same false-green shape found elsewhere. |
| Nothing reads the `tor_dev` counters | Low | The alert path for a Tor attempt is not wired. The block works; the alert does not. |

## What this project cannot do, at all

Not bugs, and no amount of work fixes them. They are in `README.md` too, and
anybody deciding whether to rely on Hearth should read them first.

- **Mobile data.** A phone that turns off wifi has left the network. Nothing at
  the network layer can reach it.
- **Anything offline.** A downloaded film, an offline game, a book.
- **What was actually watched.** Hearth sees domains, not content. It cannot
  tell an educational video from four hours of shorts, and does not try.
- **Every VPN.** Known endpoints are blocked. A determined teenager with a new
  one will get through, which is why there is a household bug bounty rather
  than a claim of being unbeatable.

## Reporting something

Open an issue, or see `SECURITY.md`. Findings are welcome and get written up
honestly, including the embarrassing ones.
