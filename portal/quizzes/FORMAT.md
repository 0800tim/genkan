# Quiz bank format

Learn-to-earn quiz banks for the kid portal. Each bank is one static JSON
file in this directory. The file is dumb on purpose: no logic, no state, no
per-kid data. All the clever stuff (sampling, scoring, cooldowns, crediting
minutes) lives in the server.

Kin project: [unrot](https://github.com/0800tim/unrot). Same deal here:
effort earns screen time.

## File shape

```json
{
  "id": "times-tables",
  "title": "Times Tables",
  "emoji": "✖️",
  "suggested_age_min": 9,
  "minutes_per_pass": 10,
  "pass_mark": 8,
  "questions_per_round": 10,
  "questions": [
    {
      "id": "tt-001",
      "prompt": "7 × 8 = ?",
      "choices": ["54", "56", "63", "48"],
      "answer_index": 1,
      "difficulty": 2,
      "explanation": "7 groups of 8 make 56."
    }
  ]
}
```

## Bank metadata

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable slug, matches the filename (`times-tables` -> `times-tables.json`). Used in `time_events.reason` as `quiz:<id>`. Never change it once shipped. |
| `title` | string | Shown on the portal. |
| `emoji` | string | One emoji for the bank's card on the portal. |
| `suggested_age_min` | int | Soft hint for which kids see the bank first. Not a lock: a younger kid can still try it. |
| `minutes_per_pass` | int | Minutes credited for a passing round. Keep modest (see anti-grind below). |
| `pass_mark` | int | Correct answers needed, out of `questions_per_round`, to earn the minutes. |
| `questions_per_round` | int | How many questions the server samples for one round. Must be well below the bank size. |

## Questions

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique within the bank. Short prefix + number (`tt-014`). Stable, so results can be logged per question. |
| `prompt` | string | The question. Plain text plus emoji is fine. |
| `choices` | array | Exactly 4 strings. All plausible, no joke options, no trick answers. |
| `answer_index` | int | 0 to 3, index of the correct choice as written in this file. |
| `difficulty` | int | 1 to 5. 1 is a warm-up, 5 is a stretch. Drives the difficulty ramp below. Optional in the schema, expected in practice: every bank shipped here has it on every question. |
| `explanation` | string | One friendly sentence shown after answering, right or wrong, and the whole content of the bank's study page. Teach, never scold. Optional in the schema, required in review: every question shipped here has one. |

The last two are "optional" only in the sense that the validator will not stop a
bank without them. A bank with no explanations is a test rather than a lesson and
will be sent back, and a bank with no difficulty is sampled flat while every
other bank ramps. Write both.

## Random sampling (why banks are big)

A round is `questions_per_round` questions drawn at random from the bank,
and the server also shuffles the choice order per question (re-mapping
`answer_index` when it does). Banks should hold at least 4x to 6x
`questions_per_round` questions so two rounds rarely look alike and there
is no fixed answer sheet to memorise. Memorising the material itself is
the whole point, so that is a win, not a cheat.

## Difficulty and the ramp

`difficulty` is optional and per question. It is the one field that changes
how a round *feels*, so it is worth getting right.

| Level | What it means | A kid in the band should |
|---|---|---|
| 1 | Warm-up. The thing everyone in the age band already knows. | get it right nearly every time |
| 2 | Easy. One step of recall or one obvious step of working. | get it right most times |
| 3 | Core. The middle of what this bank is actually teaching. | get it right about half to two thirds of the time |
| 4 | Stretch. Two steps, or a detail you only know if you paid attention. | get it sometimes |
| 5 | Hard. The interesting edge of the topic. | get it occasionally, and be pleased when they do |

Rules for a bank that uses it:

1. Label every question, not some of them. `tools/validate-quizzes.mjs`
   rejects a bank that labels some and not others, and the server is
   only a little more forgiving: a bank where fewer than half the
   questions carry `difficulty` is treated as having no difficulty data
   at all and is sampled the old flat random way.
2. Give every level enough questions to fill a round several times over.
   A rough shape that works: about a quarter of the bank at level 1, a
   quarter at 2, a quarter at 3, and the last quarter split between 4
   and 5. Levels 1 and 2 get used the most, because that is what a kid
   having a bad day is given.
3. Difficulty is relative to `suggested_age_min`, not to adults. A
   level 5 in a bank for nine year olds is easier than a level 1 in a
   bank for fifteen year olds. Pitch inside the band.
4. Difficulty is not obscurity. Level 5 is a harder idea, never a more
   obscure fact or a trick. "Which of these is a lemur?" with three
   invented species names is not level 5, it is a bad question.

### What the server does with it

When a bank has difficulty data, the portal builds each round as a ramp:
sorted easy to hard, opening with warm-ups so the kid starts by getting
things right, and finishing with the stretch questions. It also adapts
the mix to how that kid has been going lately (from `quiz_rounds` and
`quiz_answers`, see `config/db/schema-quizresults.sql`):

| How they have been going | The round they get |
|---|---|
| Struggling or just failed a round | Mostly levels 1 and 2, a couple of 3s at the end |
| Steady, or brand new to quizzes | A spread centred on level 3 |
| Passing comfortably | Centred on level 4, with 5s at the end |

Two guarantees hold whatever the profile says:

- **A round always opens with the easiest questions it contains.** No
  kid ever meets the hardest question first.
- **A round is always passable.** At least `pass_mark` questions sit at
  or below the level that kid is already comfortable with. The ramp
  stretches a kid; it never sets them up to fail.

Banks with no `difficulty` fields still work: flat random sampling, no ramp.
That path is kept for a database bank half-written in the dashboard, not as an
option for a file bank. **Every bank in this directory is labelled.** The eight
that predated the ramp were backfilled rather than left as a documented
exception, because two classes of bank behaving differently is exactly the kind
of inconsistency nobody remembers six months later.

## What the validator checks

`node tools/validate-quizzes.mjs` runs over every bank in this directory, or
over the files you name. `bin/genkan-quiz validate` calls the same thing, so a
generated bank can be checked before it is installed. It exits non-zero if any
bank fails.

Hard failures:

- The file does not parse as JSON.
- A missing or empty `id`, `title` or `emoji`; a `suggested_age_min`,
  `minutes_per_pass`, `pass_mark` or `questions_per_round` that is not a
  positive integer.
- `id` does not match the filename, or two banks share an `id`.
- `pass_mark` is greater than `questions_per_round`.
- A question with a missing or duplicate `id`, a missing or empty `prompt`, or a
  prompt that duplicates another in the same bank.
- Anything other than exactly four non-empty string choices, or two choices that
  are the same. That comparison trims but does **not** fold case, because
  "We went to New Zealand" against "we went to New Zealand" is the entire point
  of a capital-letters question.
- An `answer_index` that is not an integer from 0 to 3.
- An `explanation` that is present but is not a string.
- A `difficulty` outside 1 to 5, or a bank where some questions carry it and
  some do not. All or none.
- Fewer than `questions_per_round` questions at difficulty 1 or 2, in a bank
  that uses difficulty. A struggling kid is given a round built mostly from
  those two levels, so there has to be enough to fill one without repeating.
- Fewer than `4 x questions_per_round` questions in total.

Warnings, printed but not fatal: a difficulty level with no questions in it.

A passing line prints the question count and the ramp, so
`PASS times-tables.json (60 questions, ramped 12/16/15/12/5)` tells you the
spread across levels 1 to 5 at a glance.

What it cannot check, and what review is for: whether the answer is actually
correct, whether the explanation teaches anything, and whether the wrong answers
are plausible. Fact-check every answer yourself.

## Anti-grind rules (server-enforced, NOT in this file)

The file format stays static. The server enforces the rules below, and the
numbers in brackets are the defaults. All three are settable per household and
overridable per child on the dashboard's Learn to earn screen, under **The
rules of earning** (`earn_settings`, `config/db/schema-quizbanks.sql`). A bank
file never carries them, because they are a household's call and not a bank
author's.

1. **Cooldown per bank.** After a round (pass or fail), that bank locks
   for a cooldown (6 hours). No retry-spamming until the right answers
   fall out.
2. **Daily earn cap.** Total quiz earnings per kid per day are capped
   (30 minutes) regardless of how many banks they pass. The portal shows
   progress toward the cap, and hitting it is framed as "maxed out for
   today, nice work", never as a penalty.
3. **Mastery bonus.** A perfect round (all questions right) earns a small
   bonus on top of `minutes_per_pass` (+5 minutes). The bonus counts
   toward the daily cap.
4. **Grading is server-side.** The client never receives `answer_index`.
   The server samples the round, holds the answers, and grades the
   submission. (Yes, the raw JSON is in a public repo. Reading the source
   to learn the answers is studying. That is allowed.)

## The other shelf: banks kept in the database

Everything above describes a bank as a FILE in this directory. There is a
second place a bank can live, and it matters if you are writing tooling.

A parent can write a bank on the dashboard's **Learn to earn** screen. Those
banks are stored in Postgres (`quiz_banks` and `quiz_bank_questions`, see
`config/db/schema-quizbanks.sql`) and never written here, because this
directory is tracked in git and a `git pull` would delete a family's own
content. The portal merges the two shelves when it loads: files first, then
the database, and a file wins a clash of ids.

The two shelves differ in exactly two ways.

| | File bank | Database bank |
|---|---|---|
| Size before it goes live | 4x `questions_per_round`, enforced by `tools/validate-quizzes.mjs` | one full round, `questions_per_round` |
| Edited with | `bin/genkan-quiz`, or a pull request | the dashboard, question by question |

The size difference is deliberate and it is the one rule that bends. A parent
who has written twelve good questions should not be told to write twenty-eight
more before their child sees any of them. The dashboard says "live, but small"
on a bank under 4x and shows how far off it is. Nothing else changes: same
grading, same ramp, same cooldown, same cap.

A bank an agent writes goes in as a file, through `bin/genkan-quiz install`.
There is no bulk import into the database side yet, so a whole bank cannot be
pasted into the dashboard: it is typed in a question at a time or installed as
a file. `docs/runbooks/quiz-suggestions.md` covers which to choose.

## Contributing a bank

New banks arrive by pull request. Checklist:

- Valid JSON, fields as above, exactly 4 choices per question.
- Every `answer_index` verified correct. Fact-check every single one.
- Kid-appropriate, encouraging tone, no trick questions.
- An explanation on every question, written for the child who got it wrong.
  `CONTRIBUTING.md` has what separates a good one from a restatement of the
  answer.
- If you use `difficulty`, label every question and spread the levels
  as above. Half-labelled banks are rejected, and a bank needs at least
  `questions_per_round` questions at levels 1 and 2 so a struggling kid
  can still be given a full, passable round.
- NZ English spelling. Māori place names with correct macrons (Taupō,
  Whangārei).
- Bank size at least 4x `questions_per_round`.
