# Weekly reporting: the family digest

`bin/kidnet-report` turns a week of gateway data into a short plain-text
digest per child. It is the "section 8" piece from RECOMMENDATIONS.md: a
weekly summary to the parent that keeps screen time a conversation, not a
surveillance operation.

## What the digest contains

One block per child, for a Monday-to-Sunday week:

- **Time online.** Metered minutes from the time ledger (total, days
  active, busiest day). Where no minutes were metered it falls back to a
  rough estimate from DNS activity: how many hour-blocks had any lookups.
- **Metered categories.** Gaming and video minutes from the per-category
  meter. Music and schoolwork are never metered, and the digest says so.
- **Top sites.** The ten most-looked-up allowed domains, plus a one-line
  count of lookups the filter declined. Domains, never page contents.
- **Worth a chat.** Alerts raised that week, and any lookups matching the
  `flag_domains` watch list (Tor, self-harm, darknet directories). The
  digest labels these as conversation prompts, not verdicts. A self-harm
  flag is a care signal, never a discipline matter, and the help lines
  stay reachable through every block.
- **Earned.** Quizzes passed on the portal (count, minutes, topics),
  chores a parent approved, and any task minutes credited from the CLI.

## Philosophy: why weekly, and why this shape

A live feed of everything a child does teaches the child that they are
watched, and teaches the parent to scroll instead of talk. A weekly
summary does the opposite: it gives you two or three concrete, low-stakes
things to raise over dinner ("you earned forty minutes on times tables,
nice", "what is this Tor thing about?").

The digest deliberately cannot show message content. The network sees
domain names, not conversations: Snapchat, Discord and friends are
end-to-end encrypted, and HEARTH does not try to break that (see
PLAN.md's honest limits). That is a feature. The kids should know exactly
what the house can and cannot see, and the digest should be something you
would happily show the child it is about. Transparency runs both ways in
this house: the kids know the rules, the bug bounty invites them to poke
at the system, and the weekly digest is the parents' side of the same
openness.

Practical notes:

- It is read-only. The script only ever runs SELECT.
- `kidnet-report <child>` shows the current week so far; `kidnet-report
  <child> last` shows the previous full week; a date picks that date's
  week. `kidnet-report all` covers every child.
- Output is plain text, so it pipes cleanly into a file, an email, or a
  chat message.

## Scheduling it

Run it Monday morning over the finished week (`last`). Two host-side
units, alongside the other kidnet timers:

`/etc/systemd/system/hearth-digest.service`:

```ini
[Unit]
Description=HEARTH weekly family digest
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
# Write the digest somewhere the parents (and their agent) can read it.
ExecStart=/bin/bash -c '/opt/kids-network/bin/kidnet-report all last \
  > /var/lib/hearth/digest-$(date +%%G-W%%V).txt'
```

`/etc/systemd/system/hearth-digest.timer`:

```ini
[Unit]
Description=HEARTH weekly digest, Monday breakfast

[Timer]
OnCalendar=Mon 07:30
Persistent=true

[Install]
WantedBy=timers.target
```

Then `mkdir -p /var/lib/hearth`, `systemctl daemon-reload`, and
`systemctl enable --now hearth-digest.timer`.

To email it instead, swap the ExecStart for something like:

```ini
ExecStart=/bin/bash -c '/opt/kids-network/bin/kidnet-report all last \
  | mail -s "HEARTH weekly digest" parents@example.com'
```

(using whatever mailer the box already has: `mail`, `msmtp`, or a small
sendmail shim). Adjust `/opt/kids-network` to wherever the repo lives.

## Reading it with your agent

The digest is designed to be agent-friendly: stable plain text, one block
per child, predictable section headings. A parent's AI agent (see
docs/AGENT.md and docs/VOICE.md) can:

- Run `kidnet-report <child> last` (or read the saved
  `/var/lib/hearth/digest-*.txt`) and summarise it out loud: "Cleo did
  about six hours, mostly YouTube and Roblox, passed three quizzes,
  nothing flagged."
- Compare weeks by running the command with two different dates and
  talking through the change, since the `[week]` argument reaches any
  past week.
- Help you plan the conversation, not just the numbers: if something
  shows up under "Worth a chat", ask the agent for a gentle opener
  rather than marching in with a printout. The flag notes in the digest
  (for example "downloading Tor") carry enough context for the agent to
  suggest what the behaviour might mean, including the innocent
  readings.

Ground rule for agents, same as for parents: the digest is the start of
a conversation with the child, not evidence for a prosecution. Never
have the agent act on a flag (blocking, punishing, confronting) on its
own; flags exist so a human asks a human a question.
