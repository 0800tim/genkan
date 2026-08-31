# Runbook: keep suggesting new quizzes, for the kid you actually have

This runbook is written for an AI agent that a parent runs on a schedule.
Its job is not to write one quiz on request. Its job is to notice what a
child has been doing and propose the next thing worth learning, over and
over, so the shelf never goes stale. Humans are welcome to read it too.

The two companion runbooks cover the other jobs:

- `quiz-on-demand.md` is for "my kid is into sharks this week". One ask,
  one bank.
- `curriculum-generation.md` is for building a set of banks around a
  national curriculum.

This one is the recurring job. It is the difference between a system
that has ten quizzes in it and a system that keeps up with a child.

## What good looks like

Once a week, a parent gets a short message that says something like:

> Toby has passed Times Tables eleven times and has not opened Chess
> Basics since May. His devices have been looking up three different
> Formula 1 sites all month. I have written him a 48 question bank on
> how a Formula 1 car actually works, pitched at 12, with the braking
> and aerodynamics questions at levels 4 and 5. It validates. Say the
> word and I will install it.

That is the whole product. A specific child, a real signal, a bank they
will actually open, and a parent who still says yes or no.

The failure to design against is a bank a week that nobody takes,
because it was written for a generic eleven year old rather than for
this one.

## Step 1: gather the evidence

One command. Run it from the repo root:

```
bin/genkan-quiz-suggest <child>
```

It prints a briefing: what is on that child's list, how they are going
in each bank, which banks they have never opened, how they go at each
difficulty level, which questions they keep getting wrong, what their
devices have been looking up that nothing else explains, which services
they actually use, and which bank ids are already taken. It ends with a
prompt you can paste.

Two things about that script matter:

- **It calls no AI service.** It reads this household's Postgres and
  the bank files, and prints to the terminal. Genkan has no telemetry
  and talks to no cloud, and this does not change that. The output
  leaves the house only when a human pastes it somewhere, deliberately.
- **A fresh install prints a mostly empty briefing.** That is honest,
  not broken. There is nothing to go on until the kids have taken some
  rounds and `kids-dnslog.timer` has been filling `dns_log` for a
  while. Wait, or ask the parent what the kid is into, and use
  `quiz-on-demand.md` instead until there is a history.

Useful flags: `--days 60` widens the window, `--top 15` shows more rows
per section, `--quiet` drops the closing prompt when you are already
inside an agent.

### Where the evidence comes from, if you want to read it yourself

| Table or view | What it tells you |
|---|---|
| `quiz_form` | rounds, passes and accuracy per child per bank, last 30 days |
| `quiz_difficulty_form` | how the child goes at difficulty 1 to 5 across all banks |
| `quiz_rounds` | every graded round, pass or fail, with the mix it was built from |
| `quiz_answers` | one row per question answered, so "always gets this wrong" is a fact |
| `quiz_settings` | which banks are on this child's list, and what a pass pays them |
| `quiz_banks`, `quiz_bank_questions` | the banks the parent wrote in the dashboard |
| `time_events` where `reason like 'quiz:%'` | the money trail: every pass ever |
| `dns_log` joined to `devices` | what their own devices looked up |
| `service_usage`, `category_usage` | metered minutes per service and per category |

Schema files: `config/db/schema-quizresults.sql`,
`config/db/schema-quizbanks.sql`, `config/db/schema-services.sql`.

## Step 2: read the signals, in this order

Not every signal is worth the same. Ranked:

1. **A bank they are stuck in.** Passing under half the time, or a
   handful of questions they get wrong nearly every round. This is the
   strongest signal there is, because it is a child who is trying. The
   right answer is usually not a new bank: it is easier questions in
   the bank they are already in, or relabelling questions whose
   difficulty is plainly wrong.
2. **A topic they went looking for.** Domains in the briefing that
   nothing else explains. A kid who has been reading about volcanoes
   for three weeks will open a volcanoes quiz. This is where the good
   new banks come from.
3. **A bank they have mastered.** Passing over 85% comfortably. Write
   the next step up in the same subject, or harder questions for the
   same bank. Do not just leave them farming it.
4. **A bank they avoid.** On their list, never opened, for weeks. Ask
   why before writing anything. Often the title is dull, the topic is
   school in disguise, or the first round they got was brutal. A new
   bank on the same topic with a better angle sometimes fixes it; so
   does taking it off their list, which is a legitimate outcome.
5. **What they spend their metered time on.** Games, video, music.
   Weakest signal of the five, and the most tempting to overuse: a kid
   who plays a lot of one game does not necessarily want a quiz about
   it. Use it for the angle, not the topic. Redstone circuits taught as
   logic gates is a good bank; "how many blocks in a stack" is not.

Pick ONE thing per run. A weekly suggestion a parent actually reads
beats five they skim.

## Step 3: check it is not already there

The briefing lists every bank id in use, across both shelves: the files
in `portal/quizzes` and the banks the parent wrote in the dashboard. Do
not reuse one, and do not write a near duplicate of a bank that already
exists. If the right move is to improve an existing bank, say so
instead of writing a new one. That is a better answer and it is allowed.

## Step 4: write the bank

The format is `portal/quizzes/FORMAT.md`. The craft (difficulty ramp,
plausible distractors, explanations that teach) is all in
`quiz-on-demand.md` steps 3 to 5, and it applies here unchanged. Read
both before writing a question.

The short version:

```json
{
  "id": "how-an-f1-car-works",
  "title": "How an F1 Car Works",
  "emoji": "🏎️",
  "suggested_age_min": 12,
  "minutes_per_pass": 10,
  "pass_mark": 8,
  "questions_per_round": 10,
  "source_note": "Checked against motorsport technical references, 2026-08-30. Written from the DNS signal in the 2026-08-30 briefing.",
  "questions": [
    {
      "id": "f1-001",
      "prompt": "What is the wing on the back of an F1 car mainly for?",
      "choices": [
        "Pushing the car down onto the track",
        "Making the car lighter",
        "Cooling the engine",
        "Slowing the car in a straight line"
      ],
      "answer_index": 0,
      "difficulty": 1,
      "explanation": "It turns fast air into downforce, which is what lets the car corner so hard."
    }
  ]
}
```

Rules that are not negotiable:

- 40 to 60 questions, at least 4x `questions_per_round`.
- Exactly four choices, all plausible, none a joke.
- Every `answer_index` verified against a real source while you write
  it. A wrong answer takes minutes off a child for being right and
  teaches them something false while it does it. If you cannot verify
  it, cut the question.
- `difficulty` on every question or on none, and pitch level 1 at what
  the briefing says this child already gets right.
- An explanation on every question. It is shown right or wrong, and it
  is where most of the learning actually happens.
- Write `source_note`, and say in it which line of the briefing made
  you pick this topic. The next agent to run will thank you.

## Step 5: validate

```
bin/genkan-quiz validate /tmp/how-an-f1-car-works.json
```

It checks the JSON, the ids, four choices per question, the answer
index range, duplicate prompts, bank size against the round size, the
difficulty range, that difficulty is all or nothing, and that there are
enough easy questions to build a full round for a struggling kid. It
prints the difficulty spread on success:

```
PASS  how-an-f1-car-works.json (48 questions, ramped 12/12/12/7/5)
```

Do not ship a bank that does not pass, and do not edit the validator to
make it pass.

## Step 6: hand it to the parent. Do not install it

This is the part that makes a recurring job safe to run.

Report:

- which child, and which line of the briefing made you pick the topic
- the bank: title, age, question count, difficulty spread
- what you could NOT verify, named specifically
- the command to install it, for the parent to run

Then stop. The parent installs it, or types it into the dashboard, or
says no. A scheduled agent that quietly puts content in front of
children is a different product and not this one.

If the parent says yes, the two roads are:

```
bin/genkan-quiz install /tmp/how-an-f1-car-works.json
```

which puts it in `portal/quizzes` as a file, tracked in git and
shareable with other families; or the dashboard's **Learn to earn**
screen, **Write a new bank**, which stores it in the database instead.
Use the database when the bank is private to the household (family
history, in-jokes, a specific kid's spelling list), because a file in
`portal/quizzes` is content a `git pull` can overwrite and a database
bank is not.

Either way, take the quiz yourself before the kid does. It is their
time you are playing with.

## Step 7: run it on a schedule

There is no timer for this in the repo, and that is deliberate: what
runs it is your own agent setup, not Genkan. A weekly cron, a Claude
Code scheduled routine, or a person who remembers on Sundays are all
fine. What Genkan ships is the evidence command and this runbook.

If you do schedule it, keep it to one child per run and one suggestion
per child. The point is a parent who reads it.

## Step 8: before writing anything, check the shelf

A bank you write from scratch is not always the right answer. Somebody
may already have written it better, and it may already be sitting in
this checkout.

    bin/genkan-pack list

That prints two lists: the community learning packages installed on this
box, and the ones sitting in `portal/quizzes/community/` that nobody has
said yes to yet. A package is a quiz bank plus an author, a licence, a
description of who it is for and sometimes a page to read first
(`docs/CONTRIBUTING-CONTENT.md`).

So the order of operations for an agent doing this job is:

1. Run `bin/genkan-quiz-suggest <child>` for the evidence.
2. Run `bin/genkan-pack list` for what is already available.
3. If something on the shelf fits the child, **recommend that instead of
   writing a bank.** Say which line of the briefing made you pick it,
   and give the parent the exact command:
   `bin/genkan-pack install portal/quizzes/community/<id>.json`.
4. Only write a new bank when nothing on the shelf fits.

This matters more than it looks. The banks in `portal/quizzes` grew
around school subjects, and the shelf is where the other half lives:
painting, model aeroplanes, knots, bike repair, the things a child is
often more interested in than the curriculum. A briefing full of
Formula 1 lookups and a shelf with a model aeroplanes package on it is
not a prompt to write anything.

The same rule applies as everywhere else here: **you recommend, the
parent installs.** Do not run `genkan-pack install` yourself.

This is also the honest answer to "the dashboard should alert a parent
to packages that suit their child". That alert does not exist. The
dashboard lists what is installed and what is on the shelf and says so.
The suggesting is this runbook, run by an agent the parent chose, on the
parent's own box, against the parent's own database. Genkan has no
telemetry and calls no cloud, so it will never be a service that watches
a family and recommends things to them.

## What this does not do yet

Stated plainly, because half a feature described as a whole one is how
trust goes:

- **Nothing here runs by itself.** There is no timer, no service and no
  scheduler in Genkan for this. You wire up the recurrence.
- **Genkan never calls an AI.** `genkan-quiz-suggest` gathers and
  prints. Every model call happens in your agent, on your terms, with
  you pasting the briefing in. That is the design, not a gap to close.
- **The DNS signal is coarse.** `dns_log` records the domains a device
  looked up, not what was read on them. Three lookups of a volcano site
  is a hint, not a fact, and a shared device muddies it further. Treat
  it as a conversation starter.
- **Nothing measures whether the suggestion worked.** You can see
  afterwards whether the new bank got opened (`quiz_rounds`), but no
  part of the system closes that loop for you. A good agent checks its
  own last suggestion at the start of the next run. Nothing forces it
  to.
- **The dashboard editor cannot bulk import a JSON bank.** A bank an
  agent writes goes in as a file through `genkan-quiz install`, or it
  gets typed in question by question. Pasting a whole bank into the
  dashboard is not built.
- **Nothing tells a parent about a package on its own.** Step 8 is a
  thing an agent does when somebody runs it. There is no line on the
  dashboard that says "this package would suit your daughter", and
  building one means building the matching, not the plumbing: the
  plumbing (`genkan-quiz-suggest`, `genkan-pack list`) is already here.
