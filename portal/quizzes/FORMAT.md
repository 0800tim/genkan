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
| `explanation` | string, optional | One friendly sentence shown after answering, right or wrong. Teach, never scold. |

## Random sampling (why banks are big)

A round is `questions_per_round` questions drawn at random from the bank,
and the server also shuffles the choice order per question (re-mapping
`answer_index` when it does). Banks should hold at least 4x to 6x
`questions_per_round` questions so two rounds rarely look alike and there
is no fixed answer sheet to memorise. Memorising the material itself is
the whole point, so that is a win, not a cheat.

## Anti-grind rules (server-enforced, NOT in this file)

The file format stays static. The server enforces:

1. **Cooldown per bank.** After a round (pass or fail), that bank locks
   for a cooldown (recommended: 6 hours, or once per day per bank). No
   retry-spamming until the right answers fall out.
2. **Daily earn cap.** Total quiz earnings per kid per day are capped
   (recommended: 30 minutes) regardless of how many banks they pass.
   The portal shows progress toward the cap, and hitting it is framed as
   "maxed out for today, nice work", never as a penalty.
3. **Mastery bonus.** A perfect round (all questions right) earns a small
   bonus on top of `minutes_per_pass` (recommended: +5 minutes). The bonus
   counts toward the daily cap.
4. **Grading is server-side.** The client never receives `answer_index`.
   The server samples the round, holds the answers, and grades the
   submission. (Yes, the raw JSON is in a public repo. Reading the source
   to learn the answers is studying. That is allowed.)

## Contributing a bank

New banks arrive by pull request. Checklist:

- Valid JSON, fields as above, exactly 4 choices per question.
- Every `answer_index` verified correct. Fact-check every single one.
- Kid-appropriate, encouraging tone, no trick questions.
- NZ English spelling. Māori place names with correct macrons (Taupō,
  Whangārei).
- Bank size at least 4x `questions_per_round`.
