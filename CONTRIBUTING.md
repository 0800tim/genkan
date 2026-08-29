# Contributing

Hearth is a self-hosted, network-level parental-control island. One small Linux
box becomes the gateway for a separate kids' network, so filtering, time
budgets, category blocks and schedules are things you own. MIT, no telemetry,
your family's data never leaves your house.

Sibling project: [unrot](https://github.com/0800tim/unrot), device-side "earn
screen time by studying". This one is the network side.

## What is most useful

- **Try it and tell us where it hurt.** The setup is genuinely fiddly. Every
  place a guide assumed something is a real bug.
- **Break it.** Filter bypasses especially. Open an issue, or use the bypass
  template. That is the household bug bounty scaled up. Anything that escapes
  the island or defeats the safety net goes to SECURITY.md instead, privately.
- **Quiz banks.** They are plain JSON in `portal/quizzes/`, validated by
  `tools/validate-quizzes.mjs`, and the format is documented in
  `portal/quizzes/FORMAT.md`. A good bank from someone who knows how to teach a
  subject is worth more than most features. `docs/runbooks/curriculum-generation.md`
  is written so an agent can produce one for another country's curriculum.
- **Packaging and other distros.** It is Docker plus standard Linux tooling, so
  it should run anywhere. `docs/setup/generic-linux.md` is the contract.

## Getting oriented

| Read | For |
|---|---|
| `README.md` | what it is, and what it honestly cannot do |
| `DECISIONS.md` | why it is shaped this way, including the mistakes |
| `docs/CLI.md` | every command and its arguments |
| `docs/OPERATIONS.md` | running it, and what breaks |
| `docs/DATABASE.md` | the schema and its load order |

## Ground rules

**Never weaken four things**, and a PR that does will be declined even if
everything else is good: segment isolation, DNS forcing, the fail-closed
segment guard, and the safety net (the `scope='safety'` allowlist that keeps the
youth help lines reachable even when a child is fully cut off).

**Run the tests.** After any change to `config/nftables/kids.nft`, `gateway/` or
`bin/kidnet`:

    sudo test/firewall-test.sh      # 31 checks, throwaway namespaces
    sudo test/container-test.sh     # 26 checks, the real image

Both must pass fully. They need root because they build network namespaces; they
need no hardware. The other three suites are `meter-test.sh`,
`service-meter-test.sh` and `adguard-test.sh` (the last needs a running AdGuard
and `ADGUARD_PASS`).

**Never commit real values.** MACs, addresses, SSIDs, passwords and children's
names live only in the gitignored `config.env` and `secrets.env`. Tracked files
stay generic. The example files show the shape.

**Keep it dependency-light.** Bash, Postgres, nftables, AdGuard Home and a
little Node. It should run on a stock Debian or Ubuntu box, and on a Raspberry
Pi.

## Writing

The documentation is part of the product, and its credibility rests on being
honest about limits. So:

- New Zealand English: organise, colour, licence (the noun).
- Plain language, short sentences.
- **Say what is not built.** If a feature is half done, name which half. A
  document that describes an intention in the present tense reads exactly like
  one that describes behaviour, and only one of them is true.
- No overselling, and no marketing voice. The README is the tone to match.
