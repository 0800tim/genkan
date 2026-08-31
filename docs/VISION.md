# The vision: a smart family watchdog, educator and home brain

Genkan is an AI-first system for the family home. You talk to it (phone
chat first, open-mic voice later), it runs your kids' internet, helps them
learn to earn their screen time, and grows into the home's automation
brain. Everything open source, everything on your own hardware, in
standard containers with standard Linux underneath. Nobody outside your
house sees anything: not us, not a cloud, nobody. That is the point.

## Bring your own AI

The agent layer is LLM-agnostic by design. Families use whatever they
already pay for: Claude (the reference setup), ChatGPT/Codex, Gemini, or a
local model. The contract is simple: any agent that can run shell commands
can drive Genkan, because the entire control surface is `kidnet` plus
plain-markdown runbooks (docs/runbooks/) written for ANY agent to follow.
Add your API key or CLI login once; from then on the family talks to their
own agent on their own tailnet.

## Voice: the Alexa that answers to your house, not a corporation

Roadmap (docs/VOICE.md for the design): a wake word ("Hey Claudia" in the
reference house), local speech-to-text, speaker recognition so it knows
whose voice granted what, and a phone notification for every voice-granted
action, so the parent always sees "you (or someone sounding like you) just
gave Ben 30 minutes". All local: no audio ever leaves the house.

Voice impersonation is deliberately in the bug bounty. A kid who records
Dad and replays it EARNS the bounty the first time, then the hole gets
closed together. Speaker recognition is spoofable and we say so; the
notification trail is the real defence.

## Home automation

The gateway box is also the natural home for open home automation (Home
Assistant is the current leading choice): cameras with "someone walked
past" alerts, lights, plugs, sensors, all driven by the same agent the
family already talks to. Same rules: local-first hardware only, optional
containers, never required for the kids-network core.

## For first-timers

Flash Omarchy (or any distro with Docker) on any PC with two network
ports, clone one repo, tell your agent to set it up, plug in an access
point. Every step has a runbook a first-timer's agent can follow, and it
should FEEL fun: the setup itself is the parent's first learn-to-earn.
