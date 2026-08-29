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
3. **Read up** shows every question in a bank with the answer and why, so a
   child who scored three out of ten has somewhere to go that is not "try
   again and hope".
4. **The reading list stays open.** Wikipedia and a short list of reference
   sites survive a total cut, so a child out of time can go and genuinely
   learn something, not just answer what they already knew.
5. Pass a round, the minutes land immediately, and they can see them land.

Step 4 is the one that took longest to see. Without it, learn-to-earn is a
memory test: a child can only cash in what they already know, and the feature
rewards recall rather than learning. See `config/db/schema-learn.sql` for what
is on the list and why it is deliberately dull.

## The economics, and the honest problem with them

Right now a pass is worth about ten minutes, a perfect round adds five, each
bank has a cooldown, and quizzes are capped per day. Those are defaults, and
a household can change them.

**The open question is what a minute should cost.** The owner's position:

> "In order to earn 15 minutes of gaming, you should be learning and applying
> your learnings for at least that long. If they spend an hour looking at
> Wikipedia, doing some research and then answering questions, they should
> [earn] at least 50% of that time in game, which makes it half an hour. They
> can also just answer questions they might be good at already and get 15
> minutes."

That is two different rates for two different things, and the design does not
yet tell them apart:

- **Recall** is cheap to supply. A child who already knows their times tables
  can pass rounds quickly. That should be worth something, and not very much.
- **Learning** is the thing worth paying for, and it is the thing Hearth
  cannot currently see. Time spent reading is not measured, so a child who
  spent forty minutes on Wikipedia and then passed a hard round earns exactly
  the same as one who guessed well.

Ideas, none of them built yet, all of them arguable:

- **Pay for the first pass of a bank more than the tenth.** Learning something
  new is worth more than proving it again. Cheap to build, and it makes a
  child move on to new material rather than farming an easy bank.
- **Pay more for a bank the child has been reading about.** The gateway can
  see that a device spent thirty minutes on Wikipedia before starting the
  astronomy round. That is a real signal and it is already in `dns_log`.
- **Pay more for questions they previously got wrong.** `quiz_results` holds
  per-question history, so a bank can prefer a child's own weak spots and pay
  a premium when they get one right at last.
- **Difficulty tiers within a bank**, so a harder round is worth more. The
  bank format has no difficulty field yet.

**The risk to hold on to**: every one of those turns learning into an
optimisation problem, and a clever child will optimise it. The design should
prefer rules a child can understand and would not resent, over rules that are
hard to game. A system that feels fair gets used honestly. A system that feels
like a puzzle gets treated like one.

## Writing a quiz bank

Banks are JSON in `portal/quizzes/`. Read `portal/quizzes/FORMAT.md` for the
schema and `tools/validate-quizzes.mjs` to check your work.

What makes a good bank, learned from writing nine of them:

- **Every question needs an explanation.** Not optional. The explanation is
  the study material: it is what a child reads on the Read up page, and a bank
  without them teaches nothing. All 429 shipped questions have one.
- **Write the explanation for somebody who got it wrong**, not for somebody
  confirming they were right. "Madagascar sits in the Indian Ocean off the
  south-east coast of Africa" is better than "Correct: Africa".
- **Wrong answers should be plausible.** Three obviously silly options make a
  question a reading-comprehension test.
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
| Read up: every question, answer and explanation | built |
| The reading list open during a block | built |
| Jobs and chores, parent-approved | built |
| Per-child, per-bank enable and rate | built |
| Cooldown per bank, daily cap | built, household-wide |
| Paying more for new material than for repetition | not built |
| Paying more for what a child was reading about | not built |
| Difficulty tiers inside a bank | not built |
| Creating banks from the dashboard | see the dashboard's Learn to earn page |
| An agent suggesting banks from a child's interests | see `docs/runbooks/` |

## Contributing

Content is the easiest way in and the most useful. A bank on something a child
in your house is actually into is worth more than another maths bank, and the
project would rather have thirty niche banks than five worthy ones.

Open a pull request with the JSON and a note on who it is aimed at.
