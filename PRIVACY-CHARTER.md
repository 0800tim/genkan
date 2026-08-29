# The Hearth privacy charter

Hearth is a parental control system. That means it is one bad decision away
from being a surveillance product, and the difference between the two is not
the code, it is the promises the code keeps.

Most of these promises already exist. They are scattered through
[README.md](README.md), [DECISIONS.md](DECISIONS.md),
[ROADMAP.md](ROADMAP.md), [SECURITY.md](SECURITY.md),
[docs/tor-and-safety.md](docs/tor-and-safety.md),
[docs/HOUSEHOLD-SECURITY.md](docs/HOUSEHOLD-SECURITY.md),
[docs/GAMIFICATION.md](docs/GAMIFICATION.md) and
[docs/reporting.md](docs/reporting.md). This file gathers them into one place,
gives each one a number, and sets out how a reviewer checks a pull request
against them.

It exists because a project like this does not lose its ethics in one commit
that says "add surveillance". It loses them in eleven helpful commits over two
years, each of which seemed reasonable on its own.

---

## How this charter binds

Six rules. They are the teeth.

1. **Every commitment has an ID.** A pull request that changes behaviour
   covered by one must name the ID in its description and say how the
   commitment still holds.
2. **A commitment can only be changed by changing this file, in the same pull
   request, on its own.** Not bundled with a feature. Not "temporarily". Not in
   a follow-up. If the feature needs the promise weakened, the promise is the
   pull request, and the feature waits.
3. **Silence is a decline, not consent.** A change that adds an outbound
   network call, a new destination for a report, or a new column holding
   something about a child, and does not mention it, is treated as breaking the
   relevant commitment regardless of what the author intended.
4. **"Off by default" does not exempt anything.** A capability that exists is a
   capability that can be switched on, defaulted on later, or turned on by a
   packager. The question is always what the code can do, never what the
   shipped configuration currently does.
5. **The default answer to an ambiguous case is no.** This project's failure
   direction is deliberate and consistent: the meter under-counts rather than
   guesses, the segment guard fails closed, a check that cannot run fails
   loudly. Privacy follows the same rule.
6. **A maintainer cannot waive a commitment on their own judgement.** These are
   the terms the project is offered to families under. Changing them is a
   change to the project, not a call a reviewer makes in a thread.

A commitment held only in a document is not held. Where a promise is enforced
by the firewall, the schema or a test, that is named below, because those are
the ones a future contributor cannot quietly reverse.

---

## The commitments

### P1. No telemetry. None. Not anonymous, not aggregate, not opt-in.

Hearth does not phone home. There is no usage reporting, no crash reporting, no
"anonymous statistics", no version check that carries anything, and no
analytics of any kind. There is no account, so there is nothing to attach data
to even in principle.

This is not a setting. It is the reason the honest answer to "how do I know you
are not monetising my kids' browsing" is *read the code, it never sends
anything anywhere*, and that answer stops being available the moment a single
exception exists.

**The only outbound requests Hearth's own code makes** are the daily fetch of
the public Tor relay list (`onionoo.torproject.org`, with `dan.me.uk` as a
fallback), which downloads a public list and uploads nothing. Everything else
that leaves the box is either DNS resolution by AdGuard to its configured
upstreams, or Docker pulling images. Any third destination is a finding.

### P2. No cloud dependency for anything that matters.

If this project vanished tomorrow, every deployed gateway keeps working. No
feature may depend on a service outside the household for filtering, time
budgets, learn-to-earn, the safety net, the portal, the dashboard, or the
firewall.

This bans, specifically: a licence check, a remote configuration fetch, a
hosted blocklist that is required rather than optional, a push notification
service in the path of anything, a hosted model that must be reachable for a
core function to work, and any "sign in to continue".

The family's AI agent is the deliberate exception and it is bounded: it is the
parent's own agent, running with the parent's own subscription, and it is a
cockpit rather than a component. Hearth runs when it is closed.

### P3. No decryption of a child's traffic. Ever.

No TLS interception, no certificate installed on a child's device, no MITM
proxy, no "inspection" mode. This is the line between regulating and spying and
it is not crossed for any feature, for any age, at any parent's request.

Hearth sees domains, because it is the DNS server. It counts bytes by
destination address. It does not and will not see inside.

The metering design is built around this constraint rather than around it being
inconvenient: category and per-service attribution work by mapping addresses
learned from DNS, precisely so that encrypted traffic can be counted without
being read.

### P4. No reading of messages.

Hearth cannot see inside Snapchat, Instagram, Discord or any other end-to-end
encrypted app, and no feature will be built that tries. Not keyword scanning,
not screenshotting, not an accessibility service, not a keylogger, not a
"companion app" that reads notifications.

The project says this to parents plainly and up front, including to parents for
whom it is the wrong answer: **if bullying is your worry, this is not the
tool.** That sentence stays in the README.

### P5. No browsing history is uploaded anywhere.

DNS logs, category usage, per-service usage, quiz results, the time ledger and
the alerts all live in the household's own Postgres, on the household's own
box, and no code in this repo sends any of it anywhere.

Retention is a household's to set, and the shipped defaults are deliberately
short rather than deliberately complete. AdGuard's query log is configured at
`720h`, thirty days, with the reason stated in the config file itself: a family
does not need a permanent archive of its children's browsing. A pull request
that lengthens a retention window must justify the longer window on its own
terms, not on "the charts look better".

Screenshots count. The dashboard deliberately does not display the private
address it is reached over, because the System page is the page people
screenshot, and a screenshot is the most likely way a child's name, a MAC and a
private address leave a house at once.

### P6. No feature reports a child to anybody but their own parent.

There is one audience for everything Hearth produces about a child: the adults
responsible for that child, in that house.

This bans a school integration, a co-parenting service, a shared dashboard
hosted by anyone, a "concerned adult" recipient list, an escalation path to any
authority, and any default that mails a report to an address the parent did not
type themselves.

The one documented way a report leaves the house is a parent hand-editing a
systemd unit to pipe `kidnet-report` through their own mailer to their own
address. That is a household decision made by a human, with a shell, once. It
is not a recipients feature, and turning it into one is a charter change.

The corollary, from `docs/reporting.md` and it is not decoration: **the digest
should be something you would happily show the child it is about.** A recipient
the child does not know about fails that test.

### P7. Nothing covert. The child is told.

No hidden logging, no stealth mode, no feature whose value depends on a child
not knowing it exists. If a feature only works when the kid does not know about
it, it is the wrong feature.

This is a design position with an evidence base behind it, not squeamishness.
The day a sixteen-year-old discovers a hidden filter is the day they move to
mobile data and you lose all visibility. Transparency is also the better
engineering: it is why the bug bounty exists, why a blocked page says what is
blocked and why, and why the Switcheroo playbook tells parents to tell their
kids even though the trick works either way.

Related and equally binding: **a blocked child sees a page, not a broken
network.** Silent failure is a form of concealment. A child who is cut off is
told they are cut off, told why, and told what to do next.

### P8. No dark patterns aimed at children.

The learn-to-earn system is the part of Hearth that most resembles the products
it exists to push back against, so it carries the strictest rule: it may not
import the attention economy's toolkit.

Specifically banned, each because it was considered and rejected:

- **Streaks.** A chain that breaks is a punishment dressed as a reward, and it
  punishes a child for being sick, busy, or not in the mood.
- **Leaderboards and rankings between children.** A cumulative ranking punishes
  the youngest child by construction, every day, forever. The house board names
  who is leading a category and never names anyone as behind. No ordinal
  language, no "2nd place", no bottom of the list.
- **Scarce or competitive rewards.** Every badge is achievable by every child,
  on their own timeline. Nothing compares one child's count to another's.
- **Grinding.** Mastery is measured by covering a bank's questions, not by
  passing the same bank ten times.
- **Manufactured urgency, loss framing, or anything that makes stopping feel
  like losing something.**

And the tone rule, which is enforced in review of every quiz bank: an
explanation is written for the child who got it wrong. It never scolds and
never says "obviously" or "simply", because a child reading it has just failed
at the thing.

### P9. The safety net is never narrowed, and distress is met with care.

The `scope='safety'` allowlist keeps the youth help lines reachable when a
child is blocked, at bedtime, out of time, on an unclaimed device, and during a
full cut. It is enforced in the firewall through the `@kids_allow` set, not
merely intended, and `allow-sync` refuses to install an empty result so a
resolver blip cannot leave a child unable to reach 1737.

No pull request narrows it. No feature routes around it. No performance
argument outranks it.

Self-harm is a care signal and never a punishment: it raises an alert to a
parent and never routes a child to a blocking page. That is a structural
guarantee rather than a policy, because self-harm is an explicit exclusion from
the blocking path, so a category added later cannot quietly start putting a
struggling child in front of a wall.

The reading list is kept in a separate scope from the safety net on purpose,
because the two promises are different. A household trimming its reading list
must not be able to trim the help lines by accident.

### P10. No monetisation that depends on data.

There is no paid tier, no cloud service, no per-child pricing, and nothing to
buy. The licence is MIT so that a tool shaping how children use the internet
never depends on anyone's subscription staying current.

No revenue model may be introduced that requires collecting, retaining,
aggregating, or transmitting anything about a household or a child. That
includes an "anonymised" dataset, a research partnership, a benchmark, and a
hosted version that would hold family data. Commercial thinking about this
project lives in a separate private repository and nothing from it lands here.

### P11. A child can see their own data.

A child's own badges, their own earned minutes and their own quiz history are
always visible to that child, whatever any household switch says. The study
page shows every question in a bank with the answer and the explanation, and
carries no cooldown and no cap, because it pays nothing and there is therefore
nothing to farm.

The reverse also holds: **one child may not read another child's data.** That
has already been a real bug in this project, and the fix is treated as a
security property, not a nicety.

### P12. Guests are not surveilled.

Somebody who joins your wifi has not agreed to be watched. Guest devices are
filtered and time-controlled like anyone else on the island, and kept out of
the per-person query log, out of the weekly digest and out of the learn-to-earn
screens. Nothing about a visit outlives the visit.

### P13. No real household values enter this repository.

Every child's name in this repo is invented. Real names, MACs, addresses,
SSIDs and secrets live only in gitignored `config.env` and `secrets.env` on the
family's own box. The publish scanner refuses binaries outright, because a
screenshot of the dashboard is the single most likely way a child's name, a MAC
and a private address leave a house at once.

---

## What this charter does not promise

Stated plainly, because a charter that overstates itself is worth less than
none.

- **It is not a legal document.** It is a maintenance commitment. It binds this
  repository and the people reviewing changes to it.
- **It does not bind a fork, or your own household.** MIT means anyone can take
  this code and build something worse with it. What it does mean is that they
  cannot do it here, and that a fork which strips these promises has to say so
  itself.
- **It does not cover data your household already has.** Your Postgres is
  yours. This charter says the software will not send it anywhere, not that
  nobody in your house can read it.
- **There is a real retention gap today.** AdGuard's query log has a thirty-day
  window. The database tables it feeds (`dns_log`, `alerts`, `time_events`,
  `quiz_answers`, `category_usage`, `service_usage`) have **no stated retention
  policy and nothing prunes them**. That is a gap, it is named here rather than
  glossed over, and a pull request that adds sane defaults would be genuinely
  welcome. Until then, P5's promise is that nothing is uploaded, not that
  nothing accumulates.
- **It does not make the network see less than it sees.** Hearth is the DNS
  server. It knows every domain a device looks up. The charter constrains what
  is done with that, not the fact of it, and every parent should understand
  that before they deploy it.

---

# For reviewers

## The checklist

Run this against any pull request that touches code, schema, configuration or
documentation of behaviour. It takes about five minutes.

### 1. Does anything new leave the house?

    git diff origin/main -- . | grep -nE 'https?://|fetch\(|XMLHttpRequest|curl |wget |nc |openssl s_client|requests\.|axios|smtp|sendmail|mail -s'

List every destination the diff introduces. The permitted set is short:

- the household's own Postgres
- AdGuard's configured upstream resolvers
- `onionoo.torproject.org` and the `dan.me.uk` fallback, for the public Tor
  relay list
- DNS resolution of safety-net and reading-list domains by `allow-sync`
- Docker registries, at build and deploy time only

**Anything else is a P1 or P2 finding.** Ask what is in the request body. "It is
only a GET" is not an answer: a URL is a payload.

### 2. Does anything new get stored about a child?

    git diff origin/main -- config/db/ | grep -nE 'ADD COLUMN|CREATE TABLE'

For each new column or table, answer three questions in the pull request:

- What is it, in one sentence, in words a parent would understand?
- Who can read it: the child, the parent, another child, a guest?
- When does it get deleted, and what deletes it?

A column with no answer to the third question is retention creep. Given the gap
named above, this is the checklist item most likely to catch something real.

### 3. Does it reach a new audience?

Anything that renders, exports, mails, pushes, copies or posts information
about a child: who receives it? If the answer is anyone other than that child's
own parent, or the child themselves, it is a **P6** finding. A configurable
recipient list is a new audience even when the shipped list is empty.

### 4. Does it work better if the child does not know?

Ask it literally, of the feature as described. If the answer is yes, or "well,
it would be less effective", it is a **P7** finding. Covert features do not
become acceptable by being optional.

### 5. Does it borrow from the attention economy?

Streak, chain, rank, leaderboard, "don't lose your", countdown pressure, a
scarce badge, a reward for repetition rather than learning, a comparison
between siblings. Any of those is a **P8** finding, and every one of them has
already been considered and rejected with reasons in
[docs/GAMIFICATION.md](docs/GAMIFICATION.md). Point the contributor there
rather than re-arguing it.

### 6. Does it touch the four iron rules?

Segment isolation, DNS forcing, the fail-closed segment guard, and the safety
net. If it does, the tests are not optional:

    sudo test/firewall-test.sh
    sudo test/container-test.sh

Both must pass fully, and a test edited in the same pull request as the
behaviour it covers deserves a very close read.

### 7. Was the charter mentioned?

If the change touches any of the above and the description does not name a
commitment ID, that is itself the finding. See binding rule 3.

---

## What a charter-breaking contribution actually looks like

It never arrives labelled "adds surveillance". It arrives as a good idea from
somebody who cares about the project. Two worked examples, both of which are
realistic enough that a tired reviewer would merge them.

### Example one: "Optional anonymous quiz statistics, to make the banks better"

**The pull request.** A new config flag, `SHARE_QUIZ_STATS`, defaulting to
off. When a household switches it on, a weekly job posts aggregate statistics
to a community endpoint: per bank, per question, the pass rate and the average
time taken. No names, no addresses, no browsing, nothing identifying. The stated
purpose is entirely genuine: bank authors currently have no idea which of their
questions are too hard, too easy, or simply badly worded, and this is the only
realistic way to find out. The contributor has written it carefully, documented
it honestly, and defaulted it off.

**Why it is refused.** It breaks **P1** outright, and **P2** and **P10** on the
way past.

- The value of "Hearth never sends anything anywhere" is that it needs no
  trust. It is checkable by reading the code in an afternoon. One exception
  converts it into "Hearth sends only this, we promise", which is a privacy
  policy, and privacy policies are exactly what this project exists as an
  alternative to. The claim is worth more than the feature.
- "Anonymous" and "aggregate" do not survive contact with the size of the
  dataset. Per-question timings from a household with three children, arriving
  weekly, is a learning-profile of specific kids. Small-n aggregates
  re-identify. This is not a hypothetical worry, it is the standard result.
- It requires an endpoint. Someone has to run it, pay for it, secure it and
  decide who sees it, which is a cloud dependency and a governance problem the
  project has deliberately never had.
- Off by default is one pull request away from on by default, and neither of
  those pull requests looks like a betrayal on its own. Binding rule 4 exists
  for this exact shape.

**What to build instead.** The need is real, so answer it inside the boundary
the project already uses. `kidnet-quiz stats` and `kidnet-quiz-suggest` already
read the local record of every round including the failures. Extend those into
a proper local bank-quality report: which questions this household's children
consistently get wrong, which explanations never get read, which difficulty
labels are miscalibrated. Then give it a **copy as text** button, exactly as
the weekly digest has. A parent who wants to help a bank author pastes it into
a GitHub issue themselves.

That boundary is already written down in DECISIONS.md and it is the right one
here: **the briefing leaves the house only when a human pastes it.**

### Example two: "Push notifications so parents actually see urgent alerts"

**The pull request.** Urgent alerts currently sit in a table until somebody
opens the dashboard, which means a self-harm flag can wait hours. This is a
genuine and serious weakness, and the project's own vision document already
promises a phone notification for every voice-granted action. The contributor
implements it the normal way: a small companion app, or a web push
subscription, with notifications delivered through Firebase Cloud Messaging and
APNs, because that is how notifications reach a phone. The payload is kept
minimal on purpose: the child's first name and the alert category.

**Why it is refused.** It breaks **P2** and **P5**, and depending on the
payload, **P6**.

- Push delivery means Google and Apple are in the path. "The child's first name
  and the alert category" is not minimal: it is *Ben, self-harm, 9.40pm on a
  Tuesday*, crossing two third parties. That is the single most sensitive
  sentence this system can produce, and P5 exists to keep it in the house.
- It is a cloud dependency for something that matters. When the push service
  changes its terms, its pricing, or its API, a safety feature in somebody's
  house stops working, and they will not find out until the day it mattered.
- The recipient list becomes a feature. Once notifications have subscribers,
  adding a subscriber is a small change, and P6's audience boundary has been
  quietly turned into a configuration field.
- Note how good the motivation is. Refusing this one costs something real, and
  saying so honestly is part of holding the line rather than an argument
  against it.

**What to build instead.** Every option that keeps delivery inside the
household is open, and several are better anyway:

- The parent's own agent, already running on the box, already reachable from
  their phone over their own private network, already told by `docs/AGENT.md`
  to surface urgent alerts proactively. This is the design's own answer.
- A notification through a channel the household already runs and controls
  (their own private network, their own messaging bridge, their own ntfy
  instance), configured by the parent, pointed at themselves.
- A local escalation the box performs itself: it already knows every device in
  the house.

The rule to apply: **the household chooses its own transport and the project
ships no default that involves a third party.**

### Three more that would arrive the same way

- **"Keep `dns_log` for two years so the trend charts are useful."** A pure
  performance-and-features framing with no privacy language anywhere in it, on
  a table that currently has no retention policy at all. This is the most
  likely charter breach in the repository right now. **P5.**
- **"Quiet mode: hide the portal banner for teenagers who find it
  patronising."** Sympathetic, reasonable-sounding, and it is stealth
  monitoring with a kind face. **P7.**
- **"A daily streak, so kids come back to the quizzes."** It would work. That
  is the problem. **P8.**

---

## When a pull request trips the charter

Say which commitment, say why, and say what to build instead. Contributors who
break this charter are almost always people who care about children and about
this project, and a review that reads as an accusation loses somebody worth
keeping.

Two things not to do. Do not merge it behind a flag to keep the peace, because
binding rule 4 exists precisely because that is how it always happens. And do
not litigate a decision that already has a written reason: point at
[DECISIONS.md](DECISIONS.md), [ROADMAP.md](ROADMAP.md)'s "Things we will not
do", or [docs/GAMIFICATION.md](docs/GAMIFICATION.md), all three of which record
what was tried and why it was rejected.

If a commitment here is genuinely wrong, change it: open a pull request against
this file alone, argue it in the open, and let it stand or fall on its own.
That is the whole mechanism, and it is deliberately slower than adding a
feature.
