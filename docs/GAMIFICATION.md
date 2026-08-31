# Gamifying learn-to-earn: badges, and why the board is not a leaderboard

The owner's ask was blunt: badges, and get the siblings battling each other on
an achievement board. This document is the reasoning that sits underneath
what got built, including the parts of that ask this deliberately pushes
back on, and why.

Read `LEARN-TO-EARN.md` first if you have not. Its economics section already
names the risk this document is really about: a system a clever kid can
optimise gets treated like a puzzle, and a system that feels fair gets used
honestly. Gamification is the same trap wearing a different hat.

## The problem with "battle each other"

A household is not a matched field. A seven year old and a fifteen year old
are not playing the same game, whatever the scoreboard says:

- **A raw leaderboard punishes the youngest.** Rank children on total minutes
  earned, total quizzes passed, or total anything cumulative, and the
  youngest loses every single day, forever, by construction. They have had
  fewer years to accumulate a total than their older sibling and no quiz bank
  changes that. A feature meant to make learning feel good would instead be
  a daily reminder of a race they were entered into without being able to
  win.
- **Public failure does not motivate the child who is behind.** It motivates
  the child already winning, who gets to enjoy watching. Behavioural research
  on this is not subtle and the target audience (children who are already
  the household's most sensitive readers of fairness) does not need the
  research to feel it.
- **A streak that breaks feels like a punishment, not a lapsed reward.** A
  "don't break the chain" mechanic is one of the more well-worn tools of the
  attention economy this whole project exists to push back against
  (`README.md`: no telemetry, no dark patterns, treat kids as clever people
  worth teaching). Importing it here to make the badges "sticky" would be
  copying the enemy's toolkit into the one part of Genkan that is supposed to
  feel like the opposite of a phone that will not leave you alone.
- **A handicap formula is still a puzzle to a clever kid**, and now it is a
  puzzle a parent has to defend rather than a plain fact. "You get a bonus
  multiplier because you are younger" is exactly the kind of rule
  `LEARN-TO-EARN.md` warns against: technically fair, and resented anyway,
  because it is a formula standing between a child and an honest answer to
  "how am I doing".

None of this means comparison has to be off the table entirely. It means the
comparison has to be chosen so that being oldest, or having the most spare
time, is not automatically a win condition.

## What got built instead

### Badges: personal, never competitive

Every badge in `dashboard/badges.mjs` (`BADGES`) is checked against a
child's OWN history: their own first pass, their own tenth pass, their own
first perfect round, their own first bounce-back after a flop. Nothing
compares a count to a sibling's count, and nothing is scarce: every badge is
achievable by every child in the house, on their own timeline, which is the
opposite of a scarce trophy that only one kid can hold. A five year old and
their sixteen year old sibling can both hold all ten of them, and the five
year old getting there slower does not make either badge worth less.

Some are one-off milestones (`first_pass`, `first_perfect`, `ten_passes`,
`fifty_passes`, `five_banks`, `comeback`, `earn_hour_week`). Some can be
earned again for a different quiz bank (`explorer`, `bank_mastered`,
`read_then_pass`), so a curious kid who tries eight different subjects ends
up with eight small badges to show for it rather than one that stopped
mattering after the first bank.

`bank_mastered` deserves a specific note, because it was nearly a
"pass this bank ten times" counter, which would have rewarded repetition
over learning, exactly the trap `LEARN-TO-EARN.md` names in its economics
section. Instead it checks whether the child has answered every question
currently in the bank correctly at least once, ever, across all their
rounds (`quiz_answers`, joined back to the bank's live question list). A
forty-question bank with ten-question rounds takes real breadth of attempts
to clear this way, and the thing it actually certifies is "you have now seen
and got right the whole bank", not "you have clicked through it a lot".

### The board: spotlights, not ranks

`boardData()` in `dashboard/badges.mjs` is the one place siblings ARE
compared, and every category in it was picked to resist the age problem
above:

| Category | What it counts | Why it does not just reward being older |
|---|---|---|
| Most improved | Rise in pass rate, this fortnight vs the one before | A child already acing everything has nowhere left to improve; a child still finding their feet has the most room to move. This one runs backwards from a raw score board on purpose. |
| Widest range of subjects | Distinct banks passed in the last 30 days | Trying five different banks costs a seven year old the same effort as a fifteen year old. Neither needs to be fast or already good at anything. |
| Best comebacks | Fails followed by a pass on the same bank, last 30 days | A child who finds things hard gets MORE chances at this one, not fewer. It is arguably tilted towards whoever is having the harder time, which is the right direction to tilt. |
| Keenest reader | Visits to a bank's study page, last 30 days | Reading costs nothing to attempt and requires no existing skill. |

Two more rules make this safe rather than just differently unfair:

- **It never ranks.** There is no "2nd place". Each category names whoever
  is leading it right now (`leaders`) and then lists everyone else's own
  number next to their own name, with no ordinal language anywhere. A child
  who is not leading any category still sees their own number stated
  plainly, never as a distance behind somebody else's.
- **A category with nothing to say says nothing.** If nobody has two rounds
  in both fortnights, "most improved" is simply left off the board rather
  than crowned on a coin flip. An empty leaderboard slot dressed up as a
  real result is worse than admitting there is not enough data yet.
- **A one-child household gets a placeholder, not a lie.** `boardData` is
  only rendered as a comparison when there are at least two children in the
  house; with one, the portal says plainly that this is where it will show
  up once there is someone to compare with, rather than staging a "board"
  with an empty field.

Every category also rotates on a rolling 14 or 30 day window rather than
lifetime totals, so this month's spotlight is not just whoever got there
first in 2024 and has been coasting on it since.

### Off by default

`board_settings.enabled` defaults to `false` (`config/db/schema-badges.sql`,
enforced by `test/schema-test.sh`). This mirrors the exact call
`schema-claim.sql` made for device claiming, and for the same reason,
quoted from that file: *"A household running happily today must not wake up
with [something it never asked for]."* A sibling comparison feature is
squarely in that category. A parent turns it on from the dashboard's Learn
to earn page (`/api/board`), and the wording there is honest about what it
does and does not do, so nobody discovers it by surprise.

Badges themselves carry no such switch. They are private to the child who
earned them, visible only on that child's own portal, so there is no
household-level reason to gate them: nothing about one child's own badge
collection can put another child in a worse light.

## What was tried and rejected

- **A total-minutes or total-passes leaderboard.** The thing that was asked
  for, in the most literal reading, and the thing this document opens by
  explaining is not being built. It is the single clearest way to make a
  younger sibling feel like the network's least favourite child, which is
  the opposite of `README.md`'s stated position that Genkan treats kids as
  clever people worth teaching.
- **Login or daily-use streaks.** Never built, on purpose, and it should stay
  that way. `LEARN-TO-EARN.md` already worries about turning learning into
  an optimisation problem; a streak that punishes a missed day for being
  sick, or busy, or just not in the mood, is the attention economy's own
  playbook, not something to import into the feature that exists to push
  back against it. The rest-between-goes cooldown that already existed is
  not a streak: it never resets progress and never breaks anything a child
  has already built.
- **Age-banded numeric handicaps** (multiply a younger child's score by some
  factor to make totals "fair"). Rejected for being exactly the kind of rule
  a clever kid reverse-engineers and a parent then has to justify. The
  fortnight-over-fortnight improvement category gets a similar effect
  (younger and newer players naturally have more room to improve) without
  a formula anybody has to defend.
- **Ranking every category always, ties broken arbitrarily.** Rejected in
  favour of listing every leader when there is a tie and dropping a category
  entirely when there is not enough data, rather than manufacturing a single
  winner out of noise.
- **A visible "last place" or bottom-of-list framing anywhere.** Never
  built. The board only ever names who is leading a category; it does not
  sort or label anyone as behind.
- **Grinding-based mastery** (pass the same bank N times). Replaced with
  question-coverage mastery, described above, so the badge pays for breadth
  of learning rather than repetition of the same round.

## What is built, and what is not

| | |
|---|---|
| Ten personal badges, checked on quiz completion, idempotent | built |
| Bank-scoped badges that repeat (tried, mastered, read-then-passed) | built |
| The kid's own badge page (`/badges` on the portal) | built |
| A badge teaser on the portal home page | built |
| The house board, four fairness-checked categories | built |
| The board's household on/off switch, off by default | built |
| The parent's view: who earned what, and the toggle | built (dashboard Learn to earn page) |
| A leaderboard on totals | not built, deliberately (see above) |
| Streaks of any kind | not built, deliberately (see above) |
| Badges for things other than quizzes (jobs, chores) | not built. The same
  personal-history approach would extend cleanly (`first job done`, `ten
  jobs done`), it just was not needed to answer the ask and would grow the
  scope of `earn_claims` handling for a first pass at this feature |
| Retroactively awarding badges for history from before this feature | not
  built, and not needed: `dashboard/badges.mjs`'s `awardBadges` checks run
  once, on the round that was just graded, which keeps awarding cheap
  (`LEARN-TO-EARN.md`'s design principle: no timer sweeping the whole
  history). A family that already had a hundred passes before this shipped
  will not retroactively get "ten passes"; they will get "fifty passes" the
  next time the count clears fifty, and everything from there is honest |

## Where the pieces live

- `config/db/schema-badges.sql`: `child_badges`, `quiz_study_visits`,
  `board_settings`.
- `dashboard/badges.mjs`: the badge definitions (`BADGES`), the awarding
  logic (`awardBadges`), the board (`boardData`), and the reads both the
  portal and the dashboard use. Loaded by both processes because
  `compose.yaml` and `demo/compose.yaml` both bind-mount the whole
  `dashboard/` directory into the container that runs `portal.mjs`.
- `dashboard/portal.mjs`: awards badges right after `logRound` in
  `gradeRound`, shows the badge teaser on the home page, and serves
  `/badges`.
- `dashboard/earn.mjs` and `dashboard/server.mjs`: the parent's badge and
  board card on `/earn`, and the `/api/board` toggle.
