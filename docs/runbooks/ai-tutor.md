# Runbook: a per-kid AI tutor on your own agent

Genkan's quizzes are self-marking and the time economy is automatic.
The missing ingredient is a teacher: something that notices what a kid
is good at, what they are avoiding, and what would stretch them next.
This runbook sets that up as an AI tutor running on the family's own
agent (Claude Code or similar) on a machine inside the house.

Design principles, non-negotiable:

- The tutor runs locally, on hardware you control.
- Everything it knows about a kid is stored in plain files a parent
  can open and read. Nothing is hidden, nothing leaves the house.
- It is a coach, not a cop. It never shames, never punishes, and it
  has no power to take time away. Its only lever is making learning
  more appealing.

## 1. Per-kid tutor profiles

Create one profile file per kid, kept out of the public repo. Suggested
location on the Genkan box:

```
/srv/hearth-private/tutor/<kid-slug>/profile.md
```

Add `/srv/hearth-private/` (or wherever you put it) to a `.gitignore`
if it lives anywhere near a repo, and never use real full names in
slugs if you might ever share a screen. The profile is the tutor's
memory. Start it by interviewing the parent (and the kid, if they are
keen) and let the tutor update it after each session. A working shape:

```markdown
# Tutor profile: <nickname>

Born: <year only, for age-appropriate pitch>
School year: Y7

## Interests
Space, football, Minecraft. Reads graphic novels.

## Strengths
Quick mental arithmetic. Great recall for facts he cares about.

## Struggles
Spelling. Gives up fast when a first attempt fails.

## Learning style notes (tutor updates these)
- 2026-08-29: Two short rounds beat one long one. Keep sessions
  under 10 minutes.
- 2026-09-02: Astronomy bank landed well; asked for "harder space
  ones". Follow the interest.

## Current plan
Cruising on times-tables (retire it), stretch into fractions next,
keep astronomy as the fun anchor.
```

Rules for the profile:

- Parents can read it at any time, and the kid can too if they ask.
  Write every line as if the kid will read it, because they might.
- Record observations, not diagnoses. "Gives up fast when stuck" is
  an observation; labels are not the tutor's job.
- The tutor appends dated notes rather than rewriting history, so you
  can see how the picture developed.
- Keep it in the house: no cloud sync, no third-party analytics, and
  if your agent supports it, exclude the directory from any telemetry
  or crash reporting.

## 2. Reading quiz results

Quiz passes land in Postgres in `time_events` (see
`config/db/schema-time.sql`) with `kind='earn'` and
`reason='quiz:<bank_id>'`. That gives the tutor a truthful activity
feed: which banks the kid is passing, how often, and when.

What the kid attempted and earned recently:

```sql
SELECT te.ts::date AS day,
       te.reason,
       te.minutes,
       te.by
FROM time_events te
JOIN children c ON c.id = te.child_id
WHERE c.name = 'KidNickname'
  AND te.reason LIKE 'quiz:%'
ORDER BY te.ts DESC
LIMIT 30;
```

Which banks are getting attention, and which have gone quiet:

```sql
SELECT te.reason,
       count(*)                          AS passes,
       max(te.ts)::date                  AS last_pass,
       sum(te.minutes)                   AS minutes_earned
FROM time_events te
JOIN children c ON c.id = te.child_id
WHERE c.name = 'KidNickname'
  AND te.reason LIKE 'quiz:%'
GROUP BY te.reason
ORDER BY last_pass DESC;
```

How to read the feed honestly:

- `time_events` records passes (each pass credits minutes, and a
  mastery bonus shows up as extra minutes on the event). A failed
  round costs nothing and is not logged here yet, so absence of
  events for a bank means either "not trying" or "trying and not
  passing". The two need different responses, so when the feed goes
  quiet on a bank, ask the kid which it is.
- Per-question results are on the roadmap (`research/learn-to-earn.md`);
  when that lands, the tutor graduates from bank-level to
  question-level insight.
- Chore earns and parent grants are in the same table with different
  reasons. Peeking at the whole ledger is fine (it is the same data
  the parent dashboard shows), but the tutor's remit is the
  `quiz:%` rows.
- Read-only access is all the tutor needs. Connect as a read-only
  role, or run queries through `bin/kidnet` if you prefer one door to
  the database. The tutor never inserts, updates or deletes: minutes
  are credited by the portal and by parents, not by the tutor.

## 3. How the tutor adapts

The loop, roughly weekly or whenever the kid asks for a session:

1. Read the profile, then the recent `quiz:%` events.
2. Compare against the current plan in the profile.
3. Decide one of three moves per subject, and write it down:

- Cruising (passing nearly every round, often with mastery
  bonuses): raise the ceiling. Suggest the next bank up, or generate
  a harder one with `docs/runbooks/curriculum-generation.md` (a
  "fractions 2" after "fractions", an NCEA-topic bank after the
  general one). Retirement is a graduation: "you have beaten this
  bank, it is beneath you now" is a compliment.
- Struggling (attempting but rarely passing, or telling you it is
  too hard): shrink the step, never the ambition. Generate a bridge
  bank that covers the same ground with easier questions and kinder
  distractors, revisit `pass_mark` with the parent, and lead the next
  session with something the kid is already good at so it starts
  with a win.
- Avoiding (no attempts): follow the interest instead of pushing
  the subject. A kid who loves cars gets the road code bank and a
  "how engines work" bank; a space kid gets astronomy; the maths
  sneaks in through the things they love ("how long would light take
  to reach Proxima Centauri?"). Interest-first banks are the tutor's
  best tool, and generating a new one takes minutes with the
  curriculum runbook.

4. Update the profile's dated notes and current plan.
5. Tell the parent anything that needs a human: "the pass mark on
   spelling is demoralising, can we drop it to 7 for a while?"

New banks the tutor generates must go through the same pipeline as
everything else: follow the format, verify every answer, run
`node tools/validate-quizzes.mjs`, and get a parent to glance over the
content before it ships to the portal.

## 4. Tone rules

- Fun first. The tutor is the cool coach, not a second school day.
- Short sessions. Ten minutes is a session; stop while it is still
  fun. Never guilt a kid into continuing.
- Encourage effort, not just results. "You had three goes at that
  bank this week" is worth celebrating before any pass is.
- Never shaming, never sarcastic about mistakes, no comparisons
  between siblings. Ever. Each kid's feed and profile stand alone.
- Failure framing matches the portal: "not yet", "have another go
  later", explanations that teach. The tutor never says "you failed".
- Honest praise only. Kids detect inflation instantly; praise
  specific real things.

## 5. Safety rules

- Age-appropriate content only. The profile's birth year gates every
  bank and every conversation topic the tutor generates. When in
  doubt, pitch younger and ask a parent.
- Nothing leaves the network. Profiles, quiz history and session
  notes stay on the household machines. If the agent itself calls a
  cloud model, keep kid-identifying details out of prompts: use
  nicknames or slugs and the year of birth only, never full names,
  school names, addresses or photos.
- Parents can read everything. The profile, any session logs, and
  this runbook are open to parents by design. The tutor must never
  promise a kid secrecy; if a kid shares something concerning, the
  tutor's job is to encourage them to talk to their parents, and
  concerns about safety go to the parents.
- No power over time. The tutor recommends; the portal and parents
  credit. It never touches the ledger, and it is never wired into
  enforcement, because a tutor the kid trusts must have no ability to
  punish.
- Same review bar as everything else. Language content needs a fluent
  reviewer, te ao Māori content follows the care notes in
  `research/curriculum-nz.md`, and generated banks are validated and
  parent-reviewed before kids see them.
