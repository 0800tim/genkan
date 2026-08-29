# Learn to earn

The heart of Hearth. A child who runs out of screen time does not hit a wall,
they hit a door: pass a quiz, do a job, earn some back.

This document is the design and the open questions. If you want to contribute
content rather than code, skip to **Writing a quiz bank**.

## The idea, and the thing it is trying to avoid

Every screen-time product ends the same way: the time runs out, the child comes
to find you, and you have the argument you were trying to avoid. The clock did
not remove the negotiation, it just gave it a schedule.

So the block has to lead somewhere. Not "ask a parent", which is the same
argument with extra steps. Something the child can do on their own, that a
parent is glad they did.

## What it looks like to a child

1. Time runs out. The internet stops. The portal appears.
2. The page lists what they can do: quizzes that credit instantly, jobs that
   wait for a parent.
3. **Read up** shows every question in a bank with the answer and the
   explanation, so a child who scored three out of ten has somewhere to go that
   is not "try again and hope". Every bank has one, at `/study/<bank>` in the
   portal. There is no cooldown and no cap on reading: you cannot earn minutes
   from the study page, so there is nothing to farm.
4. **The reading list stays open.** Around forty reference sites survive a
   total cut, so a child out of time can go and genuinely learn something
   rather than only answering what they already knew.
5. Pass a round, the minutes land immediately, and they can see them land.
6. Badges, if the household has them on. Personal milestones, never a race
   against a sibling.

Step 4 is the one that took longest to see. Without it, learn-to-earn is a
memory test: a child can only cash in what they already know, and the feature
rewards recall rather than learning. `docs/READING-LIST.md` has the list, the
five tests a site has to pass, and the well-known school sites that were
rejected for failing them.

## The curriculum

The banks are the reason this feature is worth anything, and there are now
enough of them to be a real curriculum rather than a demo.

**Over 40 banks and more than 2,000 questions, and every single question
carries an explanation and a difficulty.** Ages five to NCEA, in bands:

| Band | Banks |
|---|---|
| NZ Years 1 to 3 | literacy, maths, and the world around them |
| NZ Years 4 to 6 | maths, science, English, Aotearoa New Zealand, NZ histories |
| NZ Years 7 and 8 | maths, science, English |
| NZ Years 9 and 10 | maths, science, English, history and geography, NZ histories |
| NCEA | maths Levels 1 to 3, biology, chemistry, physics |
| Across the years | te reo Māori for beginners, the arts, health and PE, places and names of Aotearoa |
| Other countries | the UK Key Stages 2 and 3, US elementary and middle school, Australian primary and secondary, Canadian elementary and secondary, Irish primary and secondary |
| General interest | times tables, world flags, world capitals, astronomy, science basics, how computers work, being online, scientists and inventions, chess, NZ geography, the NZ road code, animals of Madagascar, general knowledge |

Those numbers move: banks are still being added, and `ls portal/quizzes/*.json |
wc -l` is the count that is actually true today. The exact composition of the
bands is whatever is in that directory.

Two things are worth saying honestly about it. It is **not** a validated
curriculum and nobody has marked it against a syllabus document: it is a large,
carefully fact-checked set of questions written to sit alongside what a child is
already learning at school, not to replace any of it. And coverage is uneven,
because it grew from what real children in one house were actually studying.
Every New Zealand learning area now has at least one bank, but depth varies a
lot: maths has one per year band and te reo Māori has a single beginners bank.
Languages other than te reo have nothing, and outside the five countries above
there is nothing at all.

Every bank ramps. Every question carries a `difficulty` from 1 to 5, and the
portal builds each round easy to hard, adapting the mix to how that child has
been going lately. Two guarantees hold whatever the profile says: a round always
opens with the easiest questions it contains, and a round is always passable.
`portal/quizzes/FORMAT.md` has the detail.

## The economics, and the honest problem with them

A pass is worth ten minutes by default, a perfect round adds five, each bank has
a six hour cooldown, and quiz earnings are capped at thirty minutes a day. All
four are now settings rather than constants: `earn_settings` holds one household
row and an optional row per child, resolved through `earn_settings_effective`,
and they are edited in plain language on the dashboard's Learn to earn screen.
A household that never opens that screen gets exactly the old numbers.

**The open question is what a minute should cost.** The owner's position:

> "In order to earn 15 minutes of gaming, you should be learning and applying
> your learnings for at least that long. If they spend an hour looking at
> Wikipedia, doing some research and then answering questions, they should
> [earn] at least 50% of that time in game, which makes it half an hour. They
> can also just answer questions they might be good at already and get 15
> minutes."

That is two different rates for two different things, and the design still does
not tell them apart:

- **Recall** is cheap to supply. A child who already knows their times tables
  can pass rounds quickly. That should be worth something, and not very much.
- **Learning** is the thing worth paying for, and it is the thing Hearth
  cannot currently see. Time spent reading is not measured, so a child who
  spent forty minutes on Wikipedia and then passed a hard round earns exactly
  the same as one who guessed well.

The reading list and the study pages made that gap wider, not narrower: a child
can now genuinely go and learn, and Hearth still pays them the same as if they
had not. Ideas, none of them built:

- **Pay for the first pass of a bank more than the tenth.** Learning something
  new is worth more than proving it again. Cheap to build, and it makes a
  child move on to new material rather than farming an easy bank.
- **Pay more for a bank the child has been reading about.** The gateway can
  see that a device spent thirty minutes on Wikipedia before starting the
  astronomy round. That is a real signal and it is already in `dns_log`, and
  `quiz_study_visits` already records who read which study page.
- **Pay more for questions they previously got wrong.** `quiz_answers` holds
  per-question history, so a bank can prefer a child's own weak spots and pay
  a premium when they get one right at last.
- **Pay more for a harder round.** The ramp exists now, so the portal knows the
  difficulty of every question it served. Nothing prices it.

**The risk to hold on to**: every one of those turns learning into an
optimisation problem, and a clever child will optimise it. The design should
prefer rules a child can understand and would not resent, over rules that are
hard to game. A system that feels fair gets used honestly. A system that feels
like a puzzle gets treated like one.

## Badges, and why the board is not a leaderboard

The original ask was badges, and get the siblings battling each other on an
achievement board. Badges got built. The battle did not, on purpose.

A raw leaderboard punishes the youngest child by construction: rank children on
total minutes or total passes and the seven year old loses to the fifteen year
old every day, forever, no matter how hard they work. So the badges here are
personal milestones measured against a child's own history, and the one place
siblings are compared at all (the house board) deals only in things that do not
simply reward whoever is oldest: how much somebody has improved lately, how many
different things they have tried, how often they have come back from a flop, how
much they have read up.

**The board is off by default** (`board_settings.enabled`), because a household
should not wake up with a new social feature it never asked for. A child's own
badges and their own earnings are always visible to that child, whatever the
switch says. `docs/GAMIFICATION.md` is the full reasoning, including the
mechanics that were deliberately rejected: streaks, handicap multipliers, and
anything that makes failure public.

## Writing a quiz bank

Two shelves, and the difference matters.

**As a file**, in `portal/quizzes/`. This is how a bank arrives by pull request
and how an agent writes one. `portal/quizzes/FORMAT.md` is the schema and
`tools/validate-quizzes.mjs` checks your work. A file bank needs at least four
rounds' worth of questions before the validator passes it.

**In the dashboard**, on the Learn to earn screen. A parent writes and edits the
bank a question at a time and it is stored in Postgres (`quiz_banks`,
`quiz_bank_questions`), never in `portal/quizzes`, because that directory is
tracked in git and a `git pull` would delete a family's own content. A database
bank goes live once it holds one full round, because a parent who has written
twelve good questions should not be told to write twenty-eight more before their
child sees any of them. Its card says "live, but small" and shows how far off
four rounds it is. Nothing else differs: same server-side grading, same ramp,
same cooldown, same cap.

There is no bulk import into the database side, so a whole bank written as JSON
cannot be pasted into the dashboard. It goes in as a file through
`bin/kidnet-quiz install`, or it is typed in a question at a time.

**As a package**, from somebody outside the house. A package is the same JSON
bank with a short manifest on top: who wrote it, what licence it carries, who it
is for, and optionally a page to read first that a child sees on the Read up
screen. It installs into the database, so a Hearth update cannot delete it, and
`bin/kidnet-pack` validates, installs, lists and removes them. Anybody can write
one and it needs no code:
[`docs/CONTRIBUTING-CONTENT.md`](docs/CONTRIBUTING-CONTENT.md) is the guide, and
`portal/quizzes/community/` is the shelf, with one worked example to copy.

That shelf exists because the curriculum is the narrow half of what is worth
teaching a child. Mixing paint, trimming a balsa wing, tying a bowline and
reading a tide chart are all things somebody knows properly and could teach in
forty questions, and none of them is on a syllabus. A package about painting is
a first-class contribution here, not a lesser one.

Two honest limits on packages, both stated fully in that guide. A package is
**text and links only**: no images, no audio, no video, because the portal has
no asset pipeline and a link to an outside image would be a broken box for the
child who has run out of time and can only reach the reading list. And
**nothing suggests a package to a parent yet**. The evidence half works
(`bin/kidnet-quiz-suggest` and `bin/kidnet-pack list`, both of which call
nothing and print to a terminal), and the matching is a job for an agent the
parent runs, never for a service Hearth calls.

What makes a good bank, learned from writing a lot of them:

- **Every question needs an explanation.** Not optional, whatever the format
  file says about the field. The explanation is the study material: it is what a
  child reads on the Read up page, and a bank without them teaches nothing.
  Every question shipped in this repo has one.
- **Write the explanation for somebody who got it wrong**, not for somebody
  confirming they were right. "Madagascar sits in the Indian Ocean off the
  south-east coast of Africa" is better than "Correct: Africa".
- **Wrong answers should be plausible.** Three obviously silly options make a
  question a reading-comprehension test.
- **Label every question with a difficulty**, or none of them. Half-labelled
  banks are rejected by the validator, and the server treats a bank where fewer
  than half the questions carry one as having no difficulty data at all.
- **Aim at an age and say so.** `suggested_age_min` is a hint to a parent, not
  a restriction.
- **Enough questions that a round is not the whole bank.** Forty or more for
  ten-question rounds, so repeated attempts are not the same ten questions.
- **Nothing that dates fast**, and nothing that needs the internet to check.

New Zealand contributors: local content is genuinely useful and thin on the
ground. The road code bank exists because a teenager was learning to drive.

## What is built, and what is not

| | |
|---|---|
| Quizzes, graded on the box, credited instantly | built |
| Over 40 banks, more than 2,000 questions, every one explained | built |
| Difficulty ramp: easy to hard, adapted to recent form | built, every bank labelled |
| Read up: every question, answer and explanation | built |
| The reading list open during a block | built, around 40 sites |
| Jobs and chores, parent-approved | built |
| Per-child, per-bank enable and rate | built |
| Cooldown, daily cap, perfect-round bonus, price of a pass | built, household default with a per-child override |
| Writing and editing a bank in the dashboard | built, one question at a time |
| Per-bank pass rates and worst questions, for a parent | built |
| Badges | built, personal milestones only |
| The house board | built, **off by default**, and not a leaderboard |
| Paying more for new material than for repetition | not built |
| Paying more for what a child was reading about | not built |
| Paying more for a harder round | not built, though the ramp now knows |
| Bulk import of a JSON bank into the dashboard | not built |
| An agent suggesting banks from a child's interests | `bin/kidnet-quiz-suggest` prints the briefing; the model call and the schedule are your own agent's |

## Contributing

Content is the easiest way in and the most useful. A bank on something a child
in your house is actually into is worth more than another maths bank, and the
project would rather have thirty niche banks than five worthy ones.
`CONTRIBUTING.md` has the checklist.

Open a pull request with the JSON and a note on who it is aimed at.
