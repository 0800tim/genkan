# Learn-to-earn: quizzes on the kid portal

Short design note for the quiz feature. Kids earn screen-time minutes by
passing short gamified quizzes on the captive portal. Sibling of
[unrot](https://github.com/0800tim/unrot): effort and cleverness earn
rewards, never the other way round. Nothing here is punitive. Failing a
round costs nothing except the cooldown, and the portal always says "have
another go later", not "you failed".

## Content

Quiz banks live in `portal/quizzes/*.json`. Format spec:
`portal/quizzes/FORMAT.md`. Banks are static JSON with no logic; the
server does sampling, shuffling, grading and crediting.

## How it plugs into the existing time economy

Everything needed already exists in `config/db/schema-time.sql`:

- **`time_events`**: a passed round inserts one row, `kind='earn'`,
  `minutes=<minutes_per_pass (+bonus)>`, `reason='quiz:<bank_id>'`,
  `by='portal'`. Same audit trail as chores, so "how did they earn it"
  stays answerable.
- **`time_ledger.bonus_min`**: the earn lands in today's ledger row, the
  same path `kidnet earn` uses (`addtime` in `bin/kidnet`). The
  `time_remaining` view then just works, and so does the meter.
- **`tasks`**: chores stay in `tasks` with `needs_approval=true`. Quizzes
  do NOT need a `tasks` row each: they are self-marking, so the server
  credits directly with no parent approval step. That is the whole appeal:
  instant, honest feedback.
- **Portal**: `dashboard/portal.mjs` already renders an "Earn more time"
  list from `tasks`. The quiz cards join that page: emoji, title, minutes
  on offer, and either "Play" or "Locked until 4pm" / "Maxed out for
  today, nice work".

Optionally, an earn can top up a specific category (see METERING.md), for
example "+10 min gaming" rather than generic time. Start generic; add
per-category earns only if the generic pool gets gamed.

## Server rules (enforced, not in the JSON)

Numbers below are recommended starting points, tune in `seed.sql` or a
small `quiz_config` table later.

| Rule | Recommended | Why |
|---|---|---|
| Minutes per pass | 10 (12-15 for harder banks) | Modest. A quiz is a top-up, not an income. |
| Mastery bonus | +5 for a perfect round | Rewards actually knowing it, not scraping the pass mark. |
| Cooldown per bank | 6 hours (effectively twice a day) | Stops retry-spamming answers out of the sampler. |
| Daily quiz earn cap | 30 min per kid per day | Keeps the base allowance meaningful. Counts bonuses. |
| Round size | 10 questions sampled from 40-60 | Two rounds rarely look alike, no answer sheet to memorise. |
| Grading | server-side only | The client never sees `answer_index`. |

Failing a round: friendly message, show the explanations, cooldown starts,
no minutes lost. The daily cap message is a high-five, not a wall.

## Contributing banks (teachers, tutors, other parents)

Banks arrive by pull request, same as everything else in this repo:

1. Copy an existing bank, follow `portal/quizzes/FORMAT.md`.
2. Every `answer_index` must be verified correct. The reviewer fact-checks
   a sample; the author is vouching for all of them.
3. A CI check (small script, to write) validates: JSON parses, exactly 4
   choices, `answer_index` in range, unique ids, bank at least 4x
   `questions_per_round`.
4. Subject-matter banks get a named reviewer in the PR. Anything in te reo
   Māori, or using Māori place names, keeps macrons correct (Taupō,
   Whangārei, Waitematā).

This is the same shape as the bug bounty: the household benefits, and so
does every other family running HEARTH, because the content is open
source.

## Roadmap ideas (rough order)

- **Multiplication ladders**: timed runs up the tables (2s to 12s), beat
  your own best time, small earn per new rung. Mastery data per question
  id is already loggable from `time_events` plus a results table.
- **Typing**: words-per-minute drills. Earn scales with accuracy, not raw
  speed, so nobody learns to mash.
- **Te reo Māori basics bank**: colours, numbers, greetings, days of the
  week. Drafted like any other bank BUT flagged `needs_review` and not
  shipped until a fluent speaker has reviewed it. Getting the reo right
  matters more than shipping fast.
- **Spelling bee bank** (NZ English spelling, naturally).
- **Road code bank** for the 16-year-old: genuinely useful, and the
  official questions are well known.
- **Per-kid difficulty**: use `suggested_age_min` plus past results to
  pick which banks the portal offers first.
- **Question stats**: log per-question right/wrong to spot bad questions
  (everyone gets it wrong = probably our fault, fix the question).
