# Talking to Genkan: the family agent interface

Genkan is built agent-first and LLM-agnostic. The reference setup runs
Claude Code on the gateway box in a tmux session; the family talks to it
from their phones over their OWN tailnet (Tailscale). Any agent that can
run shell commands works the same way (Codex, Gemini CLI, a local model):
the whole control surface is `kidnet` plus plain-markdown runbooks. Bring
whatever subscription or API key you already have. Nothing goes through
anyone else's servers: the agent, the database and the network all live
in the house.

## What the parent says, what the agent runs

| You say | The agent runs |
|---|---|
| "turn off Ben's internet" | `kidnet off Ben` |
| "kill the gaming" | `kidnet game off <kid>` (or each kid) |
| "study time for Cleo" | `kidnet study on Cleo` |
| "dinner!" | `kidnet dinner` |
| "ok resume" | `kidnet resume` |
| "give Ben 30 more minutes" | `kidnet bonus Ben 30` |
| "give Ben 30 more minutes of gaming" | `kidnet grant Ben gaming 30` (clears just the gaming cap) |
| "how much time has everyone got?" | `kidnet time <kid>` per kid |
| "what's blocked right now?" | `kidnet status` |
| "whose device is this?" | `kidnet devices`, or `kidnet unassigned` |
| "that new tablet is Ada's" | `kidnet assign <mac> Ada "Ada's tablet"` |
| "what has Ben been looking at?" | `kidnet recent Ben` |
| "what's busy tonight?" | `kidnet topsites` |
| "whose phone is that new one?" | `kidnet unclaimed`, then `kidnet claims` |
| "yes, that one is Ada's" | `kidnet confirm <device>` |
| "how was this week?" | `bin/kidnet-report all last` |
| "what's been going on?" | reads alerts, block_events, time_events |

The full reference, every command and every argument, is docs/CLI.md. Read it
rather than guessing at a flag: several commands look similar and are not
(`bonus` adds general minutes, `grant` adds minutes to one category and clears
only a meter-set block, never a parent's).

The agent should confirm the action in one short line, and refuse nothing
in this table: these are the parent's calls to make.

## Approvals

Chore claims (the kid tapped "I did the dishes") appear on the dashboard
and can also be handled conversationally: the agent reads pending rows from
earn_claims and on the parent's say-so approves via the same path as the
dashboard (kidnet earn <kid> "<task>"), keeping one audit trail.

Device claims are the other queue, and they are off in most houses. If
`kidnet claim-mode` says `off`, there is nothing to approve and the agent should
not offer to switch it on unprompted: it is a change to how the whole house gets
online. When it is on, `kidnet claims` lists devices a child says are theirs and
`kidnet confirm` agrees. **A child's claim grants nothing until a parent
confirms**, so there is no hurry and no harm in leaving one waiting. The agent
must never confirm a claim on its own initiative: naming a device is the parent's
call, and the whole point of the design is that saying "this is mine" is not
enough on its own.

## Alerts

The gateway and meter write to the alerts table (severity info/warn/
urgent). The agent should surface urgent alerts proactively and summarise
the rest when asked. Urgent includes: segment guard tripped, safety net
empty, self-harm category flags (that one is a care conversation, not a
discipline one; the docs are explicit about this).

## Operating it

When something is wrong rather than when something needs changing, the agent
should reach for docs/OPERATIONS.md: how to check health, what each timer does,
what the segment guard refusing to start means, and why a device might have no
internet. It is written so an agent can work the list top to bottom.

## Boundaries built into the tools

- Help lines (1737, Youthline, Kidsline) stay reachable through every cut;
  the agent cannot and must not try to remove them.
- The reading list (Wikipedia and around forty other reference sites) also
  survives every cut, on purpose: a child out of time can still go and learn
  something. If a parent asks why a blocked child is still online, that is the
  answer, and `kidnet allow-status` shows it. Narrowing it is a household's call
  to make deliberately, never a fix for "they are still using the internet".
- The agent has no way to read message content: the network sees domains,
  never inside encrypted apps. Don't imply otherwise to parents or kids.
- Smart-home devices are never cut. `off all`, `dinner` and the rest only
  touch devices classified `personal`, so the agent cannot darken a camera or
  a door lock by pausing the kids, and should say so if asked.
- Kids may talk to the agent too (their own tailnet ACL or the portal).
  The agent answers kids honestly: what's blocked, why, what they can earn,
  and never shames them. The bug bounty is real; a kid reporting a bypass
  gets celebrated, paid the bounty, and the hole fixed.
