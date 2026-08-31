# Runbook: a quiz on anything, on demand

This runbook is written for an AI agent that a parent has asked for a
quiz. Hand it to your agent along with the topic, the ages, and
anything you know about the kid, and you should get a working bank on
the family portal in one go. Humans are welcome to read it too.

The ask sounds like this:

> Create me a quiz on the animals of Madagascar for a 12 to 15 year
> old.

That is enough. The agent's job is to turn it into a bank of questions
that starts easy, gets harder, is factually right, and lands on the kid
portal so the kid can earn screen time from it.

The companion runbook, `curriculum-generation.md`, is for the other
job: building a set of banks around a national curriculum. This one is
for "my kid is into sharks this week".

## What good looks like

A kid opens the quiz, gets the first three questions right without
breaking a sweat, feels like they know this, then meets two they have
to think about, then one they only get because they read the
explanation on an earlier round. They pass. They earn ten minutes. They
learned four things.

The failure we are designing against is the opposite: question one is
brutal, the kid feels stupid, and the whole learn-to-earn idea becomes
another thing that makes them feel bad. Everything below serves that
one distinction.

## Step 1: pin down the ask

Get these before writing anything. Ask the parent if you have to, but
guess sensibly rather than interrogating them.

| Thing | Why it matters | If unsure |
|---|---|---|
| Topic | The whole point | Ask. Never guess a topic. |
| Age band | Sets the difficulty scale and the vocabulary | Use the youngest age given |
| The kid's angle on it | "Sharks" for a kid who watches documentaries is a different bank from "sharks" for a kid who likes the scary ones | Cover both, spread across the levels |
| How long it should stay interesting | Bank size | 40 to 60 questions |

Set `suggested_age_min` to the youngest age in the band. "12 to 15"
means `suggested_age_min: 12`, and difficulty 1 must be answerable by
that 12 year old.

## Step 2: research the topic properly

Do not write from memory and hope. For anything factual, check. Use
web search, prefer sources that would survive an argument (museums,
universities, national parks, conservation organisations, standard
references) and cross-check anything surprising.

The reason is blunt: the portal grades server-side and pays out
minutes. A wrong `answer_index` takes minutes off a kid for being
right, and teaches them something false while it does it. That is worse
than not shipping the bank.

Note what you checked and when in the bank's `source_note`.

## Step 3: the exact JSON to emit

One file, `<id>.json`, matching `portal/quizzes/FORMAT.md`. Read that
file too; this is the summary.

```json
{
  "id": "madagascar-animals",
  "title": "Animals of Madagascar",
  "emoji": "🦎",
  "suggested_age_min": 12,
  "minutes_per_pass": 10,
  "pass_mark": 8,
  "questions_per_round": 10,
  "source_note": "Checked against reference sources on Malagasy wildlife, 2026-08-29.",
  "questions": [
    {
      "id": "mad-001",
      "prompt": "Madagascar is a large island off the coast of which continent?",
      "choices": ["Africa", "South America", "Australia", "Asia"],
      "answer_index": 0,
      "difficulty": 1,
      "explanation": "Madagascar sits in the Indian Ocean off the south-east coast of Africa."
    }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | Lowercase, hyphens, matches the filename exactly. Permanent once kids have earned from it. |
| `title` | What the kid sees on the card. Short. |
| `emoji` | Exactly one, and it should look like the topic. |
| `suggested_age_min` | Youngest age the bank is pitched at. |
| `minutes_per_pass` | 10 is standard. 12 for something that takes real work. Do not inflate it. |
| `pass_mark` | 8 out of 10. Never above 8 unless the parent asks. |
| `questions_per_round` | 10. |
| `source_note` | Where the facts came from and the date you checked. Optional, but write it. |
| `questions[].id` | Short prefix plus a number, unique in the bank. |
| `questions[].prompt` | The question. Plain text and emoji. |
| `questions[].choices` | Exactly 4 strings, all plausible. |
| `questions[].answer_index` | 0 to 3. Verified. |
| `questions[].difficulty` | 1 to 5. See below. Label every question or none. |
| `questions[].explanation` | One friendly sentence, shown right or wrong. |

Bank size must be at least 4x `questions_per_round`, so 40 questions
minimum for a 10 question round. 44 to 60 is better: rounds repeat less
and the ramp has more to draw on.

## Step 4: the difficulty ramp, which is the whole point

`difficulty` is what makes the round feel like mentoring rather than an
exam. The portal sorts every round easy to hard and picks the mix based
on how that kid has been going lately.

| Level | What it is | The kid in the band should |
|---|---|---|
| 1 | Warm-up. What everyone in the band already knows. | get it right nearly every time |
| 2 | Easy. One step of recall. | get it right most times |
| 3 | Core. The middle of what the bank teaches. | get it about half to two thirds of the time |
| 4 | Stretch. Two steps, or a detail you notice if you are paying attention. | get it sometimes |
| 5 | Hard. The interesting edge of the topic. | get it occasionally and feel great |

Rules:

1. **Open with warm-ups.** Write plenty of level 1. A quarter of the
   bank at level 1 and a quarter at level 2 is about right. Those are
   the questions a kid having a rough week is given, so there must be
   enough of them to build a whole round from.
2. **Never open with the hardest.** You do not control the order (the
   portal does that), but you do control the labels. A question
   labelled 1 that is actually hard breaks the ramp for everyone.
3. **Escalate within the topic, not away from it.** Level 5 is a
   harder idea, never a more obscure fact. "Which of these four
   invented species is real?" is not level 5, it is a bad question.
4. **Difficulty is relative to the age band.** Level 5 in a bank for
   nine year olds is easier than level 1 in a bank for fifteen year
   olds. Pitch inside the band you were given.
5. **Label every question or none.** The validator rejects a
   half-labelled bank, and the portal treats one as unlabelled and
   falls back to flat random sampling. There is no half way.

Target spread for a 44 question bank:

```
level 1  ##########        10
level 2  ###########       11
level 3  ############      12
level 4  ######             6
level 5  #####              5
```

### What the portal does with your labels

For every round it picks one of three mixes, from that kid's recent
results in `quiz_rounds`:

| The kid | The round |
|---|---|
| Just failed a round, or under 65% correct lately | mostly 1s and 2s, finishing on a 3 |
| Steady, or has never taken a quiz before | a spread centred on 3 |
| Over 85% correct and passing | centred on 4, finishing on 5s |

Then it sorts the round easy to hard. Two things always hold: the round
opens with the easiest questions it contains, and at least `pass_mark`
of the questions sit at or below the level that kid is already
comfortable with, so the round is always winnable. The ramp stretches a
kid. It never sets them up to fail.

## Step 5: quality rules the validator cannot check

1. **Every answer verified.** Fact-check each `answer_index` against a
   real source while you write it. If you cannot verify it, cut the
   question. Nothing about a quiz matters more than this.
2. **Plausible distractors.** The three wrong answers should be the
   mistakes a real learner makes. For "the fossa's closest relatives",
   offer big cats and dogs, because that is what people actually guess.
   Filler options ("a banana") teach a kid to answer by elimination
   instead of by knowing.
3. **One friendly line of explanation on every question.** It shows
   whether they got it right or wrong, so it must teach and never
   scold. "Half of 10 is 5" beats "wrong, try harder". A good
   explanation adds one fact the question did not contain, so even a
   wrong answer is worth something.
4. **Age-appropriate language.** Match the vocabulary to
   `suggested_age_min`. No assumed knowledge a kid that age would not
   have, and nothing frightening.
5. **No trick questions.** No double negatives, no "which of these is
   NOT", no answers that hinge on a word the kid was not meant to
   notice. If a kid who knows the material could still get it wrong,
   the question is broken.
6. **Four choices, all distinct, all the same shape.** Do not make the
   correct answer the long careful one and the others short. That is a
   free pass and kids find it in about four minutes.
7. **NZ English**, and get diacritics right (Taupō, Whangārei). If the
   bank teaches a language you do not speak fluently, get a fluent
   speaker to check it before it ships.

## Step 6: validate

From the repo root, on the file wherever you wrote it:

```
bin/genkan-quiz validate /tmp/madagascar-animals.json
```

It checks JSON parses, ids are unique and match the filename, exactly
four choices, `answer_index` in range, no duplicate prompts, bank size
at least 4x the round, `difficulty` in range 1 to 5, that difficulty is
all or nothing, and that there are enough easy questions to build a
full round for a struggling kid. It prints the difficulty spread on
success:

```
PASS  madagascar-animals.json (44 questions, ramped 10/11/12/6/5)
```

Do not ship a bank that does not pass, and do not edit the validator to
make it pass.

## Step 7: install it

```
bin/genkan-quiz install /tmp/madagascar-animals.json
```

That validates the file again, copies it into `portal/quizzes/`,
re-validates the whole set so it cannot clash with an existing bank,
and tells the portal to re-read the directory. If anything fails, the
file comes straight back out.

Then check your work:

```
bin/genkan-quiz list                  # it should be there, with its ramp
bin/genkan-quiz stats <kid>           # after they have had a go
```

Other commands: `bin/genkan-quiz remove <id>` takes a bank off the
portal (earned minutes and past results stay), and `bin/genkan-quiz
reload` re-reads the directory if you edited a file by hand.

Take the quiz yourself before the kid does. It is their time you are
playing with.

## Worked example: animals of Madagascar, ages 12 to 15

The complete bank is installed in this repo at
`portal/quizzes/madagascar-animals.json`: 44 questions, spread
10/11/12/6/5 across the five levels. Read it in full when you write
your own. Here is the shape, with two questions from each level.

```json
{
  "id": "madagascar-animals",
  "title": "Animals of Madagascar",
  "emoji": "🦎",
  "suggested_age_min": 12,
  "minutes_per_pass": 10,
  "pass_mark": 8,
  "questions_per_round": 10,
  "source_note": "Written for ages 12 to 15 as the worked example in docs/runbooks/quiz-on-demand.md. Facts checked against general reference sources on Malagasy wildlife, 2026-08-29.",
  "questions": [
    {
      "id": "mad-001",
      "prompt": "Madagascar is a large island off the coast of which continent?",
      "choices": [
        "Africa",
        "South America",
        "Australia",
        "Asia"
      ],
      "answer_index": 0,
      "difficulty": 1,
      "explanation": "Madagascar sits in the Indian Ocean off the south-east coast of Africa."
    },
    {
      "id": "mad-005",
      "prompt": "What gives the ring-tailed lemur its name?",
      "choices": [
        "Its long black and white striped tail",
        "A ring of fur around its neck",
        "The circles it runs in",
        "Rings around its eyes"
      ],
      "answer_index": 0,
      "difficulty": 1,
      "explanation": "That striped tail is held up like a flag so the troop can follow each other through the scrub."
    },
    {
      "id": "mad-011",
      "prompt": "Which is the largest lemur alive today?",
      "choices": [
        "The indri",
        "The ring-tailed lemur",
        "The aye-aye",
        "The mouse lemur"
      ],
      "answer_index": 0,
      "difficulty": 2,
      "explanation": "An indri can weigh around 7 kg, which makes it the heaviest lemur still living."
    },
    {
      "id": "mad-018",
      "prompt": "How did the tomato frog get its name?",
      "choices": [
        "Its bright red-orange colour",
        "It lives in tomato plants",
        "It only eats tomatoes",
        "Its round shape and green skin"
      ],
      "answer_index": 0,
      "difficulty": 2,
      "explanation": "A big female tomato frog really is tomato red, which warns predators to leave her alone."
    },
    {
      "id": "mad-022",
      "prompt": "What does the aye-aye do with its long, thin middle finger?",
      "choices": [
        "Hooks grubs out of holes in wood",
        "Combs its fur",
        "Digs burrows",
        "Holds on while it sleeps"
      ],
      "answer_index": 0,
      "difficulty": 3,
      "explanation": "It taps the wood, listens for a hollow, gnaws in, then fishes the grub out with that skinny finger."
    },
    {
      "id": "mad-030",
      "prompt": "How do male ring-tailed lemurs usually settle a dispute?",
      "choices": [
        "With a stink fight, wafting scent from their tails",
        "By wrestling until one gives up",
        "By racing to the top of a tree",
        "By calling loudly all night"
      ],
      "answer_index": 0,
      "difficulty": 3,
      "explanation": "They rub scent onto their tails and flick it at each other. The loser walks away, and nobody gets hurt."
    },
    {
      "id": "mad-035",
      "prompt": "The golden bamboo lemur eats bamboo shoots that contain what?",
      "choices": [
        "Cyanide",
        "Salt water",
        "Alcohol",
        "Iron filings"
      ],
      "answer_index": 0,
      "difficulty": 4,
      "explanation": "It swallows about twelve times the dose that would kill most animals its size, and nobody is quite sure how."
    },
    {
      "id": "mad-038",
      "prompt": "The ploughshare tortoise, or angonoka, is famous for what?",
      "choices": [
        "Being one of the rarest tortoises on Earth",
        "Being the fastest tortoise",
        "Living in the sea",
        "Climbing trees"
      ],
      "answer_index": 0,
      "difficulty": 4,
      "explanation": "Only a few hundred are left in the wild, in one bay in the north-west, and poaching is the reason."
    },
    {
      "id": "mad-041",
      "prompt": "How do scientists think the ancestors of lemurs first reached Madagascar?",
      "choices": [
        "They rafted across on floating vegetation",
        "They walked over a land bridge",
        "People brought them by boat",
        "They swam the channel"
      ],
      "answer_index": 0,
      "difficulty": 5,
      "explanation": "A storm-torn mat of trees carrying a few small animals is the best explanation anyone has."
    },
    {
      "id": "mad-043",
      "prompt": "The word 'lemur' comes from a Latin word meaning what?",
      "choices": [
        "Spirits of the dead",
        "Tree dweller",
        "Night hunter",
        "Ring tail"
      ],
      "answer_index": 0,
      "difficulty": 5,
      "explanation": "Linnaeus named them after Roman ghosts, for their night-time calls and huge reflective eyes."
    }
  ]
}
```

A real round built from that bank, for a kid with no history:

```
difficulty  1  1  2  2  2  3  3  3  4  5
```

The same bank, for a kid who has just failed a couple of rounds:

```
difficulty  1  1  1  1  1  2  2  2  3  3
```

And for a kid who has been passing comfortably:

```
difficulty  1  2  2  3  3  4  4  4  5  5
```

Same bank, same file, three different experiences. All three open on a
level 1 question, and all three are passable.

## Tailoring to the kid

The topic is the easy part. These are what make a kid come back:

- **Use their angle.** A kid who plays Minecraft will answer questions
  about redstone circuits and learn logic gates by the back door. A kid
  who is into a band will take a music theory bank if the examples are
  their songs. Ask the parent what the kid actually talks about.
- **Name things they know.** A question about their own town, their
  sport, their favourite film lands harder than a generic one.
- **Pitch level 1 at what they already told you they know.** If a kid
  can name every lemur, their level 1 is not "what is a lemur".
- **Two focused banks beat one sprawling one.** "Animals of Madagascar"
  and "Madagascar's forests" are better than "Madagascar".
- **Watch the stats.** `genkan-quiz stats <kid>` shows accuracy per
  difficulty level. If they are at 30% on level 3, the level 3
  questions are really level 4 and you should relabel them. If they are
  at 95% on level 5, write harder ones.
- **Household banks are fine.** Family history, the dog's birthday, the
  rules of the card game your family plays. Keep those in your own copy
  rather than sending them upstream.

## Keeping a bank encouraging

The tone of a bank is set by a hundred small choices. The ones that
matter:

- Explanations teach, never scold. Never "you should know this".
- No question makes a kid feel stupid for not knowing something an
  adult would not know either.
- Never trick them. The kid should always be able to see, afterwards,
  why the right answer was right.
- Write explanations that are worth reading when they got it right.
  That is where most of the actual learning happens.
- Keep the interesting stuff at level 4 and 5, so getting there feels
  like a reward and not a punishment.
- Remember the portal frames a fail as "have another go later, the
  questions change". Write questions that make that true.

## Contributing it back

If the bank is good and not private to your household, other families
can use it. Fork, branch `banks/<topic>`, add the file, run
`node tools/validate-quizzes.mjs`, and open a pull request saying the
age band, your sources, and the date you verified the facts. See
`CONTRIBUTING.md`.
