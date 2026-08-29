# Talking to Hearth: the family agent interface

Hearth is built agent-first and LLM-agnostic. The reference setup runs
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
| "what's been going on?" | reads alerts, block_events, time_events |

The agent should confirm the action in one short line, and refuse nothing
in this table: these are the parent's calls to make.

## Approvals

Chore claims (the kid tapped "I did the dishes") appear on the dashboard
and can also be handled conversationally: the agent reads pending rows from
earn_claims and on the parent's say-so approves via the same path as the
dashboard (kidnet earn <kid> "<task>"), keeping one audit trail.

## Alerts

The gateway and meter write to the alerts table (severity info/warn/
urgent). The agent should surface urgent alerts proactively and summarise
the rest when asked. Urgent includes: segment guard tripped, safety net
empty, self-harm category flags (that one is a care conversation, not a
discipline one; the docs are explicit about this).

## Boundaries built into the tools

- Help lines (1737, Youthline, Kidsline) stay reachable through every cut;
  the agent cannot and must not try to remove them.
- The agent has no way to read message content: the network sees domains,
  never inside encrypted apps. Don't imply otherwise to parents or kids.
- Kids may talk to the agent too (their own tailnet ACL or the portal).
  The agent answers kids honestly: what's blocked, why, what they can earn,
  and never shames them. The bug bounty is real; a kid reporting a bypass
  gets celebrated, paid the bounty, and the hole fixed.
