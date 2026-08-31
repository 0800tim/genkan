# Security: what is fixed, what is open

Genkan ships its own adversarial audits in `research/`, which is unusual and
deliberate. The cost of that honesty is that a reader, human or AI, can quote a
finding without checking whether it is still true. That has already happened:
an external reviewer read the reports and told a parent to fix the DNS-log
poisoning before trusting Genkan, hours after it had been fixed.

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
| `bin/genkan` connecting to Postgres as a superuser | High | `660e3c9` | Every CLI operation and every timer now connects as `kids_agent`: no password, so it cannot authenticate over TCP at all; no `DELETE` on the tables holding a child's history; and no route to `COPY ... TO PROGRAM`. Proven by firing the review's own payload at 21 verbs and checking the file it would have created is absent. `test/db-role-test.sh`, 77 checks. |
| Ungated interpolations in CLI-only paths | Medium | `660e3c9` | 55 argument sites gated across `bin/`, `gateway/` and `demo/`. An id read back out of the database counts as an argument too, and every argument is now checked before the first connection opens. |
| The Tor relay list never reaching the firewall | Medium | `3869c53` | Confirmed, and the cause was not the one assumed. The apply step existed; its readiness guard skipped it every time and exited 0, because `deploy.sh` runs the unit in exactly the two minutes the gateway has no firewall loaded. Three runs, three skips, zero applies, all logged as success. Measured empty on the live box, so a stock Tor Browser would have connected. The addresses now go into Postgres and the gateway rebuilds the set from there at startup and hourly. `genkan-health` asks the firewall what it holds rather than reading a file's modification time, which is what had been reporting the list as current. `test/tor-test.sh`, 25 checks. |
| The safety alert path failing silently | High | `ccc4181` | A bash comment inside a SQL string killed `genkan-alerts` for a day. It reported "nothing new" and exited 0 throughout. A failed query now raises an urgent alert of its own. `test/alerts-test.sh`, 15 checks. |
| `genkan-health` reporting a working firewall as broken | Low | `3869c53` | `printf \| grep -q` under `set -o pipefail`: a match makes grep exit, the producer dies of SIGPIPE, and pipefail reports the successful match as a failure. Latent until the ruleset outgrew the pipe buffer. The same pattern in `genkan-upgrade` would have waved a failing test suite through a release gate. |

## Open, and honestly so

| Finding | Severity | Status |
|---|---|---|
| `kids_known` is fed by DHCP leases | High | Real. A device that gets a lease is known. Device claiming closes it (`docs/DEVICE-IDENTITY.md`) but **ships off by default**, so it is open until a household turns it on. That default is deliberate: switching it on changes what happens to every unrecognised device, and a family should choose that rather than inherit it from an update. |
| `DASH_TOKEN` handed to any unauthenticated GET | Medium | By design, and weaker than its comment claimed. It buys CSRF protection, not a perimeter. The perimeter is the private network the dashboard binds to. Do not expose the dashboard publicly without putting real authentication in front of it. |
| Nothing reads the `tor_dev` counters | Low | The alert path for a Tor attempt is not wired. The counters tick now that the block is actually in force, and nothing reads them, so a child reaching for a relay is refused but no parent is told. |

## What this project cannot do, at all

Not bugs, and no amount of work fixes them. They are in `README.md` too, and
anybody deciding whether to rely on Genkan should read them first.

- **Mobile data.** A phone that turns off wifi has left the network. Nothing at
  the network layer can reach it.
- **Anything offline.** A downloaded film, an offline game, a book.
- **What was actually watched.** Genkan sees domains, not content. It cannot
  tell an educational video from four hours of shorts, and does not try.
- **Every VPN.** Known endpoints are blocked. A determined teenager with a new
  one will get through, which is why there is a household bug bounty rather
  than a claim of being unbeatable.

## Reporting something

Open an issue, or see `SECURITY.md`. Findings are welcome and get written up
honestly, including the embarrassing ones.
