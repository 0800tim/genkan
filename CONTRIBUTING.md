# Contributing

Hearth is a self-hosted, network-level parental-control island. One small Linux
box becomes the gateway for a separate kids' network, so filtering, time
budgets, category blocks and schedules are things you own. MIT, no telemetry,
your family's data never leaves your house.

Sibling project: [unrot](https://github.com/0800tim/unrot), device-side "earn
screen time by studying". This one is the network side.

## What is most useful

**Write a quiz bank.** This is the easiest way in and the most useful thing
anybody can do here. It needs no networking knowledge, no hardware, and no
running Hearth: a bank is one JSON file.

- The format is `portal/quizzes/FORMAT.md`. Read it once, all of it.
- `node tools/validate-quizzes.mjs` checks your work: valid JSON, four choices
  per question, an in-range answer, unique ids, difficulty labelled on every
  question or none, and the bank at least four rounds' worth of questions.
- Copy an existing bank in `portal/quizzes/` and work from its shape.

There are over 40 banks now, so the gaps are what matter rather than the count.
Every New Zealand learning area has at least one bank, but depth varies a lot:
maths has one per year band, te reo Māori has a single beginners bank. Languages
beyond te reo have nothing, and no country outside New Zealand, the UK, the US,
Australia, Canada and Ireland is covered at all.
`docs/runbooks/curriculum-generation.md` is written to be handed to
your own AI agent for a country's curriculum, and
`docs/runbooks/quiz-suggestions.md` is the recurring version: an agent reads what
one child has actually been doing and proposes the next bank for them. Whatever
writes the draft, **a human has to check every answer.**

### What makes a good bank

The mechanics are in FORMAT.md. These are the judgement calls it cannot enforce.

**Every question needs an explanation, and the explanation is the bank.** It is
what a child reads on the Read up page after getting it wrong, and it is the
only part of a quiz that actually teaches. A bank of correct questions with no
explanations is a test, and a test teaches nobody anything. Every question in
this repo has one and any new bank without them will be sent back.

A good explanation:

- **Is written for the child who got it wrong**, not for the one confirming they
  were right. "Correct: Africa" tells that child nothing. "Madagascar sits in
  the Indian Ocean off the south-east coast of Africa" tells them where to put
  it next time.
- **Gives the reason, not the restatement.** "7 groups of 8 make 56" beats "The
  answer is 56". If the question is a fact with no reason behind it, give the
  hook that makes it stick.
- **Is one or two sentences.** It appears under a question a child just got
  wrong. A paragraph gets skipped.
- **Never scolds, and never says "obviously" or "simply".** A child reading this
  has just failed at it.
- **Stands on its own.** It is read on the study page away from the round, so it
  cannot refer to "the other options" or "option B".

Then the rest:

- **Wrong answers must be plausible.** Three obviously silly options turn a
  question into a reading test. Use the mistake a child actually makes.
- **Label every question with a difficulty**, 1 to 5, relative to
  `suggested_age_min` and not to an adult. Half-labelled banks are rejected.
  Difficulty is a harder idea, never a more obscure fact: a question with three
  invented species names in it is not level 5, it is a bad question.
- **Enough questions that a round is not the whole bank.** Forty or more for
  ten-question rounds.
- **Fact-check every single answer**, and prefer nothing that dates fast.
- **NZ English**, and correct macrons on Māori words (Taupō, Whangārei).

Open a pull request with the JSON and a note on who it is aimed at. A parent can
also write a bank in the dashboard, in which case it is stored in the database
rather than here, so a repo update cannot delete it: that is for one household's
own content, and a pull request is for content worth sharing.

### Teach something that is not a school subject

**This is the most welcome contribution here and the least obvious one.**

The banks above grew around school subjects because that is what one household
needed. Plenty of what is worth teaching a child is not on anybody's curriculum:
how to mix paint so it stops going brown, how to trim a balsa wing so a model
aeroplane flies straight, how to tie a bowline, how to read a tide chart,
sharpen a chisel, keep a starter alive, wire a plug, look after a bike.

That kind of content ships as a **package**: the same JSON bank with a short
manifest on top saying who wrote it, what licence it carries and who it is for,
plus an optional page to read first. Packages go in `portal/quizzes/community/`,
where nothing is live until a household installs it, so your file cannot change
what anybody's children see without somebody saying yes to it.

- **`docs/CONTRIBUTING-CONTENT.md` is the guide.** It is written for a person
  who is not a programmer, and it covers the format, the licence question, what
  gets a package turned down, and exactly what is not supported (pictures, sound
  and video, and why).
- `portal/quizzes/community/paint-and-colour.json` is a complete worked example
  to copy.
- `node tools/validate-package.mjs --strict <file>` checks it. It needs nothing
  but this repo and Node: no hardware, no running Hearth.

A package is treated as hostile input, because a stranger's text ends up on a
page a child reads. The validator refuses anything that could be read as markup,
any link that is not on the reading list, and anything oversized, and the portal
escapes every field again on the way out. `test/package-test.sh` proves both
halves separately.

### The rest

- **Try it and tell us where it hurt.** The setup is genuinely fiddly. Every
  place a guide assumed something is a real bug.
- **Break it.** Filter bypasses especially. Open an issue, or use the bypass
  template. That is the household bug bounty scaled up. Anything that escapes
  the island or defeats the safety net goes to SECURITY.md instead, privately.
- **Add to the reading list.** `docs/READING-LIST.md` has the five tests a site
  has to pass and the well-known ones that failed them. Adding a domain is a row
  in `config/db/schema-learn-intl.sql`, but read the rejections first: the list
  only works while it stays dull.
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
| `LEARN-TO-EARN.md` | the quizzes and the reading list: the design, and what is not built |
| `portal/quizzes/FORMAT.md` | the quiz bank format, in full |
| `docs/CONTRIBUTING-CONTENT.md` | writing a learning package, for a non-programmer |

## Ground rules

**Read [PRIVACY-CHARTER.md](PRIVACY-CHARTER.md) before you open a pull request
that touches code, schema or configuration.** It gathers the promises this
project makes to families (no telemetry, no cloud dependency, no decryption, no
reading of messages, nothing uploaded, no report to anyone but a child's own
parent, nothing covert, no dark patterns aimed at kids, no monetisation that
depends on data) into thirteen numbered commitments, and it carries the
checklist a reviewer runs your pull request through. The point of the numbers is
that a change touching one of them has to name it. A charter-breaking
contribution never arrives labelled as one: it arrives as a helpful feature from
somebody who cares, and the worked examples in that file are there so both of us
recognise the shape early.

**Never weaken four things**, and a PR that does will be declined even if
everything else is good: segment isolation, DNS forcing, the fail-closed
segment guard, and the safety net (the `scope='safety'` allowlist that keeps the
youth help lines reachable even when a child is fully cut off).

**Run the tests.** After any change to `config/nftables/kids.nft`, `gateway/` or
`bin/kidnet`:

    sudo test/firewall-test.sh      # 36 checks, throwaway namespaces
    sudo test/container-test.sh     # 26 checks, the real image

Both must pass fully. They need root because they build network namespaces; they
need no hardware. There are ten suites in total: the other eight are
`iot-policy-test.sh` (39 checks, the household IoT layer), `roles-test.sh`
(99 checks, who each scoped control reaches), `schema-test.sh` (88 checks, a
fresh install into an empty database), `schedule-test.sh` (57 checks, scheduled
bedtimes and who may lift a block), `package-test.sh` (31 checks, a community
learning package treated as hostile input), `meter-test.sh` (8),
`service-meter-test.sh` (6) and `adguard-test.sh` (9, and it needs a running
AdGuard and `ADGUARD_PASS`). `schema-test.sh`, `schedule-test.sh` and
`package-test.sh` are the three that need no root and touch nothing that is
running.

If you touch anything in `config/db/`, run `test/schema-test.sh`. Every other
suite runs against a database that was built up over months, so none of them
would notice that a fresh install no longer loads.

If you touch anything that unblocks a child, run `test/schedule-test.sh` too.

If you touch `tools/validate-package.mjs`, `bin/kidnet-pack`, the portal's
`esc()` or anything a community package's text passes through, run
`test/package-test.sh`. It builds fourteen hostile packages, proves each one is
refused, then forces one into the database by hand and proves the portal still
renders it inert. A stored cross-site scripting hole in the kid portal would be
the worst bug this project could ship.
`category_state.set_by` decides who may lift a block, and the rules are not
obvious: a schedule lifts only `set_by='bedtime'`, earning time lifts only
`set_by='out-of-time'`, and a parent beats both. The precedence table is in
DECISIONS.md under "Bedtimes ran themselves". Getting it wrong means either a
child cut off all morning or a bedtime a quiz can buy its way past, and neither
shows up until it is nine at night.

**If you add an assertion, probe with bash, not an external binary.** A negative
assertion whose probe never runs reports PASS, so a missing tool turns a safety
guarantee into a green tick. Eleven of these assertions were doing exactly that
until 2026-08-29, because they used netcat and Arch does not ship it. Use bash's
own `/dev/tcp`, treat exit 127 as a hard failure, and find `nft` with
`command -v` rather than assuming a path.

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
