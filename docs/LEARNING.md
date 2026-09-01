# Learning: the other half of Genkan

**Status: a vision and a design, with one built half.** Learn-to-earn exists
and is in daily use. The Learning home is being built as this page is written.
Everything else here (study notes from schools, AI tutors, anything social) is
not built, and every section says so in its first line. The table near the end
is the one place to check what is real.

This page is written for two readers. A parent or a teacher deciding whether
this is worth their time. And an AI agent that somebody has pointed at the
repository and asked to summarise it, which is why the promises are stated as
plainly as the plans.

## The short version

- Genkan started as a filter and a clock. The part that turned out to matter is
  the part that teaches: over 40 quiz banks, a study page for every one, a
  reading list a cut-off child can still reach. That is built. `LEARN-TO-EARN.md`
  is the honest account of it.
- The plan is to make that a proper place to learn, not a doorway back to the
  internet: a Learning home organised by year and subject, study notes a
  school can publish for its own families, and an AI tutor that knows what a
  child has been finding hard and helps them with it.
- The tutor runs on the family's own box. The child's work stays in the
  family's own database. Only the question at hand, plus the minimum context
  for a lesson, goes to a model the parent chose with the parent's own key,
  or to a local model in the house that sends nothing anywhere. The parent
  can read every word that left. Nothing leaves until a parent switches it on.
- The software is free and stays free. A family pays their model provider
  directly, in cents per session. A hosted token option may come later so a
  family without an API account can take part, at cost plus a small published
  margin, and never required.
- A school gets its notes in front of its families, with its name on them. It
  gets no data about any child. Not a report, not a count, not ever.
- Friends and leaderboards between houses are roadmap only, opt-in, and the
  reasons the house board is not a leaderboard today apply twice as hard
  between strangers' children.

## 1. What learn-to-earn is today

Built, running in one real house and in the public demo at
`quiz-demo.genkan.nz`. `LEARN-TO-EARN.md` has the design, the economics and
the open questions; this is the summary.

A child who runs out of time hits a door, not a wall. The portal offers
quizzes that credit minutes instantly and jobs that wait for a parent. Every
question carries a difficulty and an explanation written for the child who got
it wrong, and every bank has a Read up page listing every question, answer and
explanation, with no cooldown and no cap because reading earns nothing. Around
forty reference sites (Wikipedia, Te Ara, NASA, the National Library) survive a
total cut so a child can go and learn something before a round rather than
only cashing in what they already knew.

Over 40 banks, more than 2,000 questions, New Zealand Years 1 to 3 through
NCEA across every learning area, then the UK, the United States, Australia,
Canada and Ireland, and general banks such as times tables, world flags,
astronomy, chess and the road code. A parent can write a bank in the dashboard
a question at a time. An agent can write one as a file in minutes. Somebody
outside the house can hand over a package (`docs/CONTRIBUTING-CONTENT.md`).

Two honest limits, repeated here because they matter to what follows. It is
not a validated curriculum and nobody has marked it against a syllabus
document. And Genkan pays for recall and for learning at the same rate,
because it cannot yet see the difference. Both are the reason the rest of this
page exists.

## 2. The Learning home

**Status: in progress.** Being built as this page is written, by another
agent, on another branch. What it looks like when it lands is the code's to
say, not this page's. This section describes the intent so a reviewer can
check the result against it.

Today a child meets the quizzes as a shelf of cards sorted roughly by age. A
ten year old sees a te reo bank next to NCEA chemistry next to world flags. It
works as a doorway. It is not a place to learn.

The Learning home is meant to be that place. One page per child, organised
the way school is organised:

- **A year, set by a parent.** The child's school year and country. New
  Zealand years first, because that is where the banks are deepest; the other
  five countries map by age band.
- **Subjects under the year.** Maths, science, English, the social sciences,
  and the rest of the learning areas, each listing the banks and Read up
  pages for that year band, then the banks a year either side, because a
  child is rarely exactly on their year in every subject.
- **What they have read and what they have passed**, per subject, from the
  household's own records (`quiz_study_visits`, `quiz_rounds`), so a child
  can see for themselves where they have been and where the gaps are. Their
  own data, shown to them, which the charter already promises (P11).
- **The reading list grouped by subject**, so "go and read up on fractions"
  has a page to land on.
- **General interest kept separate**, because chess and the road code belong
  to a child, not a year.
- **A parent's mirror on the dashboard**: the same page, per child, with
  what a parent can change (the year, which banks are on, what a pass pays).

What it is not: a syllabus. A year band on this page means "banks that were
written with that year in mind", and the page should say so. The curriculum
research (`research/curriculum-nz.md`) is explicit that the New Zealand
curriculum is mid-refresh and that banks should pin to topics and levels, not
to a document that is being rewritten. The Learning home follows that.

## 3. Study notes from schools

**Status: not built.** No package kind for notes exists, no school has been
approached, and nothing below is a feature. It is the design, and it is here
so a school reading this can see what they would be agreeing to before anyone
asks them.

The idea, in the owner's words: if a school can give us its notes for each
year, we can load those in and bring study notes into the environment.

### What a school would give

Plain text. The notes a teacher already hands out, per year, per subject, per
topic: the fractions notes for Year 5, the genetics summary for NCEA Level 1
biology. A named teacher who will read the finished package and put their name
on it. A licence the registry accepts (`docs/CONTRIBUTING-CONTENT.md` names
the four), because a family must be able to install, keep and change what
they installed without asking anybody. And the school's name, to go on the
package.

Not photos, not video, not worksheets as images. The portal has no asset
pipeline and `docs/CONTRIBUTING-CONTENT.md` says why: a link to an outside
image is a broken box for the child who has run out of time. A school whose
notes cannot be taught without a diagram is real evidence for building asset
support, and it should say so.

### How notes become a package

`docs/COMMUNITY.md` designs a registry of signed, static packages in five
kinds. School notes would be a sixth kind, `notes`, or an extension of the
read-first page that quiz packages already carry. Either way the shape is the
same as everything else in that design:

- One JSON file per package. A set of study pages, each tagged with a year
  band, a subject and a topic, so the Learning home can file them under the
  right year. Text and reading-list links only. Optionally, a quiz bank per
  topic, written by the teacher or drafted by a parent's agent from the notes
  and then checked by the teacher, as a separate quiz package the notes
  package names.
- The same validator, treating every string as hostile input, because a
  school's notes are still a stranger's writing going in front of a child.
- Installed into the household database by a parent, at a terminal, as a
  deliberate act. A `git pull` cannot delete it and a Genkan update cannot
  overwrite it.
- Removed cleanly. Every row carries the package id.

A school could publish through the public Genkan registry, or run its own.
The registry design already allows a household to point at a different index
with a different signing key (`genkan pack source`, proposed). A school's own
index, with the school's key, holding the school's notes, is the natural fit:
the school decides what is in it, and a family points at it once.

### Who reviews

Three people, and the registry design names the flag for each:

| Who | Does | Flag |
|---|---|---|
| The validator | Checks the file is well formed, safe to render, and links only to the reading list. Cannot tell a right answer from a wrong one. | `validated` |
| A named teacher at the school | Reads every page and every question and says so, in public, by name. | `checked` |
| The parent | Installs it, or does not. Sees the author, the licence and the review flag first. | |

A wrong answer takes minutes off a child for being right, so `checked` means
a person read it, not that a script did. That is the whole review system and
it is the same one every other package gets.

The content bug bounty (`docs/COMMUNITY.md`, section 5) extends to school
notes without changing. A child who finds a wrong answer in their own school's
notes, shows a parent, and gets it fixed for every family has done something
the school would want to know about, and the fix goes out as a new version
with the child's name on the entry if they want it there.

### What a newsletter to parents would say

A school that publishes notes would tell its families. This is a draft of the
paragraph, so that the promise in it is written down before any school is
asked to send it. It is deliberately short and it makes no claim the software
cannot keep.

> Our study notes for Years 4 to 8 are now available for families who run
> Genkan, a free, open-source family internet gateway that lets children earn
> screen time by learning. The notes are the same ones we hand out in class.
> They are free, they need no account, and they work on a computer in your
> own home. Nothing about your child comes back to the school: we cannot see
> who has installed them, who has read them, or how anyone did on a quiz, and
> that is by design. If you find a mistake in the notes, tell us and we will
> fix it for every family. Setting Genkan up is a real piece of home
> networking, and the project is honest about that; the guide is at
> genkan.nz.

### What the school gets, and does not get

Gets: its notes in front of its own families, in the place a child goes when
they have run out of screen time, with the school's name on them. Corrections
flowing back from families as issues against a public file. A private
registry if it wants one. The satisfaction of the thing.

Does not get: **any data about any child, ever.** No report of who installed
the notes, who read them, who passed a quiz or who did not. No class
dashboard. No "engagement" figure. No count of installs, not even an
anonymous one, because the registry design has no counts at all and
recommends against building them.

This is not a setting a school could ask to have switched on. The privacy
charter's P6 says that no feature reports a child to anybody but their own
parent, and names a school integration as the first thing that bans. A
school can be a source of content. It can never be a recipient of data. The
one audience for anything Genkan produces about a child is the adults
responsible for that child, in that house.

## 4. AI tutors

**Status: not built as a feature.** What exists today is a runbook,
`docs/runbooks/ai-tutor.md`, that a parent hands to their own agent. It works,
it is honest about being a recipe rather than a product, and the design below
grows out of its rules rather than replacing them.

The owner's ask: AI agents that really understand the kid and help train and
tutor them. World-class tutoring for children, with the data and everything in
control in their house. Both halves of that sentence are the design. The
second half is the constraint the first half has to be built inside.

### The rule: the tutor stays in the house

The tutor is a program that runs on the family's box, next to the dashboard,
on the parent's side of the house. Not a service we run. Not a cloud the
child's work is uploaded to. The child's quiz history, what they have read,
what they keep getting wrong, the notes the tutor keeps about how they learn:
all of it lives in the household's own database and nowhere else.

What does leave the house is one thing: the conversation with the model.
When a child asks the tutor a question, the tutor sends that question, plus
the minimum context a lesson needs, to a model the parent chose. The model
sends back words. That exchange is the only outbound request the feature
makes, it is made to exactly one destination the parent named, and every
word of it is stored on the box where the parent can read it.

Nothing is sent until a parent turns the tutor on. Off is the shipped state,
off is what an upgrade leaves it in, and off means the code path is inert
and the destination is empty.

A household that wants nothing to leave at all runs a local model instead,
and then nothing does.

### What exists today: the runbook

`docs/runbooks/ai-tutor.md` sets up a per-child tutor on the family's own
agent (Claude Code or similar) on a machine in the house. It keeps a plain
text profile per child that a parent can open, reads quiz results from the
database through a read-only connection, adapts the plan weekly (raise the
ceiling, shrink the step, or follow the interest), and carries tone and safety
rules that the built-in tutor inherits word for word: a coach not a cop,
never shames, never compares siblings, never promises a child secrecy, and
has no power over time.

Its honest limit is that it is a recipe. A parent runs it by hand, in a
terminal, with an agent they already have. The child never talks to it
directly. The built-in tutor is the version a child can use from the portal,
and the runbook is where its rules were worked out.

### How a built-in tutor would work

This is a design. None of it is code.

1. **A parent switches it on**, for one child, on the dashboard, after
   reading the tutor rules page and ticking that they have. The switch names
   the provider and the model. It cannot be switched on from the CLI in one
   word, and it cannot be switched on by a child.
2. **The child opens the tutor from the Learning home**, on a subject or on a
   bank. The page says, in the child's first words with it, that this is a
   program, which model it talks to, and that a parent can read the chat.
   Nothing about the tutor works better if the child does not know (P7).
3. **The tutor builds the request on the box.** An age-band system prompt
   from the repo, in plain text a parent can read. The subject and the bank.
   The last few turns of this conversation. The child's nickname or nothing.
   If the parent ticked it, the short list of questions in this bank the
   child has recently got wrong, as question text, so the tutor can start
   where the trouble is.
4. **The request is stored, then sent**, to the one hostname the parent's
   choice of provider resolves to. The reply is stored too.
5. **The child reads the reply and carries on.** When they are done, or the
   session hits the length the parent set, the tutor says so and points at
   the Read up page.
6. **The parent can open every session**, on the dashboard, and see exactly
   what was sent, exactly what came back, and what it cost in tokens.

Where it runs matters, because of how Genkan is built. The gateway container
owns the island and has, on purpose, no route to anything but the island and
the internet through its uplink. The tutor process would live on the host
side, where the dashboard and the CLI already live, and the portal would hand
it a message over one narrow route inside the box. The tutor process would be
the single place in Genkan that ever opens a connection to a model, so "what
can reach a model" is one process with one configured destination, and a test
can prove the island container itself cannot.

### What leaves, exactly

Written as a list because a list can be checked and a paragraph cannot.

May be sent, and only when the parent has switched the tutor on:

- the age-band system prompt, which is a file in the repository
- the subject, the bank name and the topic
- the question the child typed, and the recent turns of the same conversation
- the child's nickname, or nothing, never a surname
- if the parent ticked it: the text of questions in that bank the child has
  recently answered wrong

Never sent, by any setting, at any age:

- the DNS log, or anything derived from it
- the device list, addresses, or anything about the network
- the time ledger, minutes earned, minutes left, or any block
- anything about another child, or any comparison between children
- a full name, a school's name, a date of birth, a location
- a raw log of any kind, in whole or in part

The parent sees the whole request. Not a summary of it, the request. The
first time the tutor is switched on it can run in a "show me first" mode
where the child's message builds the request and the parent has to read it
and press send before anything leaves. That mode is also what a reviewer
would use to check that this list is true.

One thing Genkan cannot promise and will not pretend to: once a sentence has
gone to a model provider, that provider's terms govern what happens to it.
Genkan controls what is sent and to whom. It does not control what a provider
does with it afterwards. Every provider publishes a data policy for API
traffic, and the setup steps below tell a parent where to find it and what to
look for. A family that does not want to take that on runs a local model.

### Bring your own key

The parent pays their provider directly, and Genkan never sees the key, the
account or the bill. Three providers are the intended first set, because
between them they cover what most families already have an account with:

- **Anthropic (Claude)**
- **OpenAI (ChatGPT's models)**
- **Google (Gemini)**

The steps would be the same shape for each. They are written here so a parent
can see what they would be agreeing to, and every command in them is
proposed rather than existing:

1. Make an account at the provider's developer console, if you do not have
   one. This is separate from a chat subscription: a ChatGPT or Claude
   subscription does not come with an API key.
2. Make an API key. Give it a name like "genkan tutor" so you can find it
   later and delete it on its own.
3. **Put a spending limit on it at the provider.** Every console has one.
   Set it low. A tutor session costs cents, so a limit of a few dollars a
   month is a real ceiling and not a nuisance.
4. Read the provider's data policy for API use. The question to answer is
   whether what you send is retained, for how long, and whether it is used to
   train anything. The answer differs by provider and by setting, and it is
   the parent's decision to make with their eyes open.
5. On the box, `genkan tutor key <provider>` (proposed) stores the key in
   `secrets.env`, which is gitignored and is never read by anything inside
   the island.
6. On the dashboard, choose the model. Cheaper models are fine tutors for
   most of primary school; the more capable ones earn their price at NCEA.
7. Read the tutor rules page, tick it, switch the tutor on for one child,
   run one session in "show me first" mode, and read what left.

Any other provider with an OpenAI-compatible API would work through the same
door, because that shape has become the common one, but only the three above
would be tested and named in the setup guide.

### A local model

For a household that wants nothing to leave at all, the tutor can point at a
model running on a machine in the house, through Ollama or anything that
speaks the same API. Then the "what leaves" list above is empty, no key
exists, and no charter change is needed, because there is no outbound
request.

The honest trade:

- **It needs a machine.** The gateway box is often a Raspberry Pi or an old
  laptop, and neither runs a useful model. A desktop with a modern graphics
  card, or a Mac with enough memory, on the parent's side of the house, does.
  The tutor process reaches it over the house's own network, which the island
  cannot see.
- **It is a weaker tutor.** A model that fits on a home machine is slower and
  is wrong more often than the hosted ones, and the difference is largest on
  exactly the hard questions where a child most needs it to be right. That
  gap closes every year. It has not closed.
- **The same rules apply.** Off by default, the parent reads the rules,
  every session is stored on the box, the age-band prompt is the same file.
  A local model is not a reason to log less.

### What a tutor may and may not do

The rules the runbook already carries, made binding for the built-in tutor:

- **It never marks.** Quizzes are graded on the box by the portal, from the
  answer index in the bank, and nothing the tutor says changes a grade.
- **It never credits, never blocks, never lifts a block.** It cannot write to
  the time ledger, and it is never wired into enforcement, because a tutor a
  child trusts must have no power to punish. Its only lever is making
  learning more appealing.
- **It never replaces the parent.** Chores still need a parent's approval,
  bedtimes are still a parent's, and a child asking the tutor for more time
  gets pointed at the quizzes and at their parent.
- **It never talks to a child before the parent has read the rules.** The
  switch is behind the rules page, per child, and there is no other way to
  turn it on.
- **It uses an age-appropriate system prompt**, one per age band, kept in the
  repository as plain text, so a parent can read what the tutor was told to
  be, and so can the child. The prompt tells it to pitch younger when unsure
  and to send anything worrying to the parent.
- **It never promises secrecy.** The child is told a parent can read the
  chat. If a child says something that worries the tutor, the tutor's job is
  to encourage them to talk to their parent, and the parent sees the session.
  Self-harm remains a care signal, never a punishment (P9).
- **It never compares siblings**, and it cannot, because it is never sent
  anything about another child.
- **It keeps a log the parent can read.** Every session, every request,
  every reply, on the box, visible to the parent and to the child it is about
  (P11), and pruned after a retention the household sets, with a default
  measured in weeks rather than years.
- **When it cannot answer, the child sees a page, not a broken screen.** A
  refused request, a dead key, a provider outage: the portal says the tutor
  is not available right now and points at Read up, which always is.

### What it costs

The software is free. The model is paid for by the parent, to the provider,
at the provider's published price per token. Genkan takes nothing and sees
nothing.

Prices change and the provider's own page is the only true figure, so here is
the arithmetic rather than a number to trust. A tutoring session of fifteen
minutes is around a dozen exchanges. Each exchange resends the system prompt
and the conversation so far, so a session sends something like 40,000 tokens
in over its length and gets 4,000 back. At the mid-range price hosted models
were charging in mid 2026 (a few dollars per million tokens in, ten or so
out), that session costs roughly ten to fifteen US cents. The cheapest
capable models bring it under five cents. The most capable ones bring it to
around thirty. A child who used the tutor every school day for a month would
cost a family, at those rates, somewhere between one and six US dollars.

That is why bring-your-own-key comes first and why the spending limit at the
provider is a setup step rather than a suggestion. It is a small number, and
a parent should still be the one who sees it.

### A hosted option, later

A hosted token option may come later, so that a family without an API
account of their own can still take part, sold at cost plus a small published
margin that funds development, and never required: bring-your-own-key and a
local model stay first-class, and nothing about a household ever travels with
a token, because a token is compute and not data.

It is not built, it is not decided, and it could not be built without first
rewriting the charter's P10 and the roadmap's "nothing to buy" line in the
open. Section 6 says what that rewrite would have to promise.

### The AI child summary

**Status: being built, by another agent, on another branch.** A parent asks
for a plain-language summary of how one child is going: what they have been
passing, avoiding and getting wrong, written by a model from the household's
own quiz records. It is the parent's tool, not the child's, and the charter
wording proposed in section 6 covers it and the tutor together, because the
promise is the same: the parent turns it on, the parent sees what leaves, one
model the parent chose, and no raw logs. The DNS log is never part of it.

## 5. Social: later, opt-in, and why not yet

**Status: roadmap only.** Nothing social exists between houses, nothing is
designed, and this section is here so that when it is designed the reasons
below are already written down.

The owner's framing: friends leaderboards and stuff like that can come later,
it all runs on their system, but we can have some social interaction later.
The key thing is that the data and everything is in control in their house.

Three things follow from that framing:

- **It runs house to house, or not at all.** A friend in another house means
  something about a child leaves this house for that one. There is no
  version of this that goes through a server we run, because that server
  would be the first thing in Genkan that watched households (`docs/COMMUNITY.md`,
  section 1, and the charter's P1 and P2). Whatever is built has to be a
  child choosing to share one specific thing with one named friend, and a
  parent in each house approving it, over the households' own connections.
- **Opt-in, per child, per friend, and off by default forever.** The house
  board is off by default because a household should not wake up with a
  social feature it never asked for. Between houses that is truer.
- **A leaderboard between houses would be a leaderboard.** `docs/GAMIFICATION.md`
  explains why the house board names who is leading a category and never
  names anyone as behind: a cumulative ranking punishes the youngest child by
  construction, every day, forever. Between siblings that is a design flaw.
  Between strangers' children it is a design flaw with an audience. Any
  cross-house feature inherits the house board's rules whole: no ranks, no
  totals, no streaks, no last place, categories chosen so that being older or
  having more spare time is not a win condition, and nothing public about
  failure. The charter's P8 already bans the rest.

What might be worth building, when it is time: a friend can see that you
finished a project module and say well done. Two children can do the same
bank on the same evening and compare explanations, not scores. A child can
send a friend a bank they liked. Each is a design question for a day when the
Learning home exists and there is something to be social about.

## 6. What would change in the charter

`PRIVACY-CHARTER.md` binds this project, and binding rule 2 says a commitment
is changed by changing that file, on its own, in the open. This section does
not change it. It proposes the exact wording so the owner can decide, and so
a reviewer can see what the tutor and the summary would cost the charter
before either is built.

The tutor with a hosted model, and the AI child summary, both send something
about a child to a third party. That is new, and the charter as written
forbids it: P1 lists the only outbound requests Genkan's own code makes, and
P2's one bounded exception is the parent's own agent as a cockpit. The
proposal is one new commitment carrying the rules, and four small amendments
that point at it.

### Proposed P14. Nothing about a child reaches a model unless a parent turns it on, and the parent can read every word that left.

> Two features send text to a model provider: the AI tutor and the AI child
> summary. Both are governed by this commitment, and any future feature that
> sends anything to a model is too.
>
> - **Off by default, per child, and off again after every upgrade until a
>   parent says otherwise.** The switch sits behind a page of rules the
>   parent has to read. It cannot be turned on from a single command and it
>   cannot be turned on by a child.
> - **One model, chosen by the parent, with the parent's own key.** The
>   destination is one hostname. Genkan ships no default provider, no default
>   key, and no destination of its own. A local model in the house is a
>   supported choice, and with it nothing leaves at all.
> - **The minimum context for a lesson, and nothing else.** What may be sent
>   is a short list written in `docs/LEARNING.md` and copied into the setup
>   page: an age-band system prompt from the repository, the subject and
>   bank, the conversation at hand, a nickname or nothing, and, only if the
>   parent ticks it, the text of recently missed questions in that bank. What
>   may never be sent is longer: the DNS log, the device list, the time
>   ledger, anything about another child, a full name, a school, a date of
>   birth, a location, or any raw log in whole or in part.
> - **The parent sees exactly what leaves.** Every request and every reply is
>   stored on the box before it is sent, verbatim, and is readable by the
>   parent and by the child it is about. A "show me first" mode holds every
>   request for the parent to read and send by hand. No summary of the
>   request stands in for the request.
> - **The child is told.** The tutor says what it is, which model it talks
>   to, and that a parent can read the chat. It never promises secrecy.
> - **It has no power.** Nothing a model says grades a quiz, credits a
>   minute, or lifts or applies a block.
> - **Retention is short and stated.** Sessions are pruned after a window the
>   household sets, with a shipped default measured in weeks. This is the
>   first table about a child in this project with a retention policy on the
>   day it is created, and every later one has to match it.
> - **A provider is a third party.** What a provider does with what it
>   receives is governed by that provider's terms, not by this charter. This
>   charter promises what is sent and to whom. It does not pretend to
>   promise more.

### Proposed amendments

**P1**, after the paragraph listing the Tor relay fetch, add:

> Two features send text to a model provider, and only after a parent has
> switched them on for a named child: the AI tutor and the AI child summary.
> Neither is telemetry. Nothing goes to us, nothing goes anywhere the parent
> did not name, and the parent can read the whole of what was sent. They are
> governed by P14. Until a parent switches one on, the code path is inert and
> the destination is empty.

**P2**, after the paragraph about the family's AI agent, add:

> The AI tutor and the AI child summary are a second bounded exception on the
> same terms: the parent's own provider, the parent's own key, and Genkan
> runs when they are off. Neither may ever be in the path of filtering, time
> budgets, the safety net, the portal, a quiz being graded, or the firewall.
> A dead key or a provider outage costs a family the tutor and nothing else.

**P5**, after the first paragraph, add:

> The AI tutor and the AI child summary send no browsing history, no DNS log,
> no device list and no time ledger, in whole or in part, by any setting.
> P14 lists what they may send, and it is short.

**P6**, after the first paragraph, add:

> A model provider receiving a tutoring question under P14 is a third party
> and this charter says so. It is permitted only because a parent chose it,
> only for the minimum context of a lesson, and only with the whole exchange
> readable by that parent. It is not a report about a child, it never
> receives one, and it is not a precedent for any other recipient.

**P10**, replace "There is no paid tier, no cloud service, no per-child
pricing, and nothing to buy" with:

> There is no paid tier, no cloud service, and no per-child pricing. The
> software is complete and free. If a hosted token option for the AI tutor
> is ever offered, it sells model compute at a published price with a
> published margin, requires no account beyond a balance, carries nothing
> about a household or a child in either direction, and is never required:
> a family with their own key, or a local model, has the whole feature. A
> paid route that a family had to take to get any part of learning would
> break this commitment.

And `ROADMAP.md`'s "A paid tier, or a cloud service. There is nothing to buy
and nothing to subscribe to" would need the same care in the same pull
request. These are the owner's decisions and this page makes none of them.

The reviewer's checklist in the charter already catches this whole feature:
question 1 (does anything new leave the house) and question 3 (does it reach
a new audience) are both yes. The wording above is what the answer to "and
how does the commitment still hold" would have to be.

## 7. What is built, and what is not

| | |
|---|---|
| Learn-to-earn: quizzes graded on the box, credited instantly | built |
| Over 40 banks, every question with a difficulty and an explanation | built |
| Read up: a study page per bank, no cooldown, no cap | built |
| The reading list, reachable through a total cut | built, around 40 sites |
| Badges, and the house board that is not a leaderboard | built, board off by default |
| Parent-written banks in the dashboard | built, one question at a time |
| Community quiz packages, validated as hostile input | built, `bin/genkan-pack` |
| A per-child tutor as a runbook for the parent's own agent | built as a runbook, `docs/runbooks/ai-tutor.md`; nothing a child can open |
| The Learning home: one page per child, by year and subject | **in progress** on another branch as this page is written |
| A parent setting a child's year and country | in progress, with the Learning home |
| School notes as a package kind | not built; no `notes` kind, no validator for it |
| A school running its own registry | not built; the registry itself is not built (`docs/COMMUNITY.md`) |
| Any school approached, any newsletter sent | no |
| The built-in AI tutor a child talks to from the portal | not built |
| Bring-your-own-key for Anthropic, OpenAI and Google | not built; `genkan tutor key` does not exist |
| A local model through Ollama | not built |
| Age-band system prompts as files in the repo | not written |
| Tutor sessions stored on the box, readable by the parent | not built; no table exists |
| "Show me first" mode | not built |
| The AI child summary for a parent | **being built** on another branch as this page is written |
| The charter changes in section 6 | proposed here, not made |
| A hosted token option | not built, not decided, and needs the charter changed first |
| Friends, sharing, anything between houses | not designed |
| Paying more for learning than for recall | not built, still the open question in `LEARN-TO-EARN.md` |

## 8. How to contribute content

Content is still the highest value contribution in the project and it needs
no networking knowledge. A bank on something a child in your house is
actually into is worth more than another maths bank.

- **Write a quiz bank.** `portal/quizzes/FORMAT.md` is the format,
  `CONTRIBUTING.md` is what makes a good explanation, and
  `node tools/validate-quizzes.mjs` checks your work. The gaps: depth in te
  reo Māori, languages beyond it, and any country outside the six covered.
- **Write a package**, for something a school does not teach:
  `docs/CONTRIBUTING-CONTENT.md`. Painting, knots, a tide chart.
- **If you are a teacher or a school**, the thing to do today is write a bank
  or a package under your own name, because the notes package kind in
  section 3 does not exist yet, and the review process in
  `docs/COMMUNITY.md` is what your notes would go through when it does. If
  you would consider publishing your notes, open an issue and say so: a
  school willing to try is the thing that makes the package kind worth
  building.
- **If you can run a model locally**, the local tutor path needs somebody who
  will test it on a real machine and say honestly how good the tutor is at
  each size.
- **If you know a curriculum**, `docs/runbooks/curriculum-generation.md` is
  written to be handed to your own agent, and a human checks every answer.

Open an issue and say hello. `CONTRIBUTING.md` has the ground rules, and the
first of them is to read the privacy charter, because the promises on this
page are only worth anything if the next contributor keeps them too.
