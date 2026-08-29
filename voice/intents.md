# Voice intents: what you can say, and what runs

The grammar is small on purpose. This is not an assistant, it is a remote
control for `bin/kidnet` with a microphone attached. Every intent below maps
onto a verb from docs/AGENT.md, and there is nothing voice can do that the
phone agent cannot already do.

Reference household: Ada (16), Ben (14), Cleo (11).

Every activation follows the same shape:

```
"hey claudia" -> transcript -> speaker guess -> intent match -> maybe confirm
              -> run -> voice_events row -> phone push -> spoken reply
```

The `voice_events` row is written whether or not anything ran. See
config/db/schema-voice.sql.

## Name resolution comes first

Whisper mishears names, especially short ones. "Ben" comes back as "Leo",
"CO", "Ben's" and "the O". So the pipeline never trusts the raw string:

1. Pull the roster from the database (`SELECT name FROM children`).
2. Fuzzy match the heard token against it, case-insensitive, ignoring
   possessives, using a small edit distance.
3. One clear winner: use it. Two plausible candidates, or none: that is an
   ambiguous parse, and the rules further down apply.

The same goes for numbers. Whisper writes "thirty" and "30" and occasionally
"3d". Parse both words and digits, reject anything that does not land on a
whole number between 1 and 240, and never round a number you are not sure of
upwards.

## The intent table

`<kid>` is a resolved roster name. `<n>` is a parsed integer of minutes.

| Intent id | Spoken, and the usual variants | Runs | Confirm? |
|---|---|---|---|
| `dinner` | "dinner", "dinner time", "dinner everyone", "tea time" | `kidnet dinner` | no |
| `resume` | "ok resume", "resume", "everyone back on", "we're done" | `kidnet resume` | no |
| `internet.off` | "turn off Ben's internet", "Ben off", "cut Ben off", "internet off for Ben" | `kidnet off Ben` | no |
| `internet.on` | "turn Ben's internet back on", "Ben on", "let Ben back on" | `kidnet on Ben` | **yes** |
| `internet.off.all` | "everyone off", "kill the internet", "all off" | `kidnet off all` | no |
| `game.off` | "kill the gaming", "no more gaming", "gaming off for Cleo" | `kidnet game off <kid>`, or once per kid if nobody is named | no |
| `game.on` | "gaming back on for Cleo" | `kidnet game on Cleo` | **yes** |
| `media.off` | "turn off YouTube", "no more TikTok", "media off for Ada" | `kidnet media off Ada` | no |
| `media.on` | "Ada can have YouTube back" | `kidnet media on Ada` | **yes** |
| `study.on` | "study time for Cleo", "homework mode for Cleo" | `kidnet study on Cleo` | no |
| `study.off` | "Cleo's finished studying", "study off for Cleo" | `kidnet study off Cleo` | **yes** |
| `bonus` | "give Ada 30 more minutes", "another 20 minutes for Ben" | `kidnet bonus Ada 30 voice` | **yes, always** |
| `grant.category` | "give Ben 30 more minutes of gaming" | `kidnet grant Ben gaming 30` | **yes, always** |
| `earn` | "Cleo did the dishes" | `kidnet earn Cleo "dishes"` | **yes, always** |
| `penalty` | "take 30 minutes off Ben" | `kidnet penalty Ben 30 voice` | **yes** |
| `time.query` | "how much time has Ada got", "how much time has everyone got" | `kidnet time <kid>`, per kid | no, read only |
| `status.query` | "what's blocked", "what's off right now" | `kidnet status` | no, read only |
| `activity.query` | "what's Cleo been up to", "what's Cleo been looking at" | `kidnet recent Cleo 10`, spoken as a short summary | no, read only |

The read-only three (`time.query`, `status.query`, `activity.query`) run
without confirmation because the worst case is that someone hears something
they could have read off the dashboard anyway. They still write a
`voice_events` row, and `activity.query` still notifies: a kid should not be
able to have their browsing read out to the room without the parent knowing it
happened.

### "kill the gaming" with nobody named

`kidnet game off` needs a kid. Spoken commands often do not have one, because
the parent means "all of them". Resolve it this way: if no name is heard, run
the command once per child (`kind='child'`, so a visiting friend is not swept
up), and say so out loud: "gaming off for Ada, Ben and Cleo". Never
silently pick one kid.

The same applies to "everyone off", which maps to `kidnet off all`. That verb
already leaves IoT and infrastructure alone, so the security camera and the
door lock stay up. Do not reimplement that logic here.

## What needs confirmation, and why

**Every intent that grants time or restores access requires spoken
confirmation, no matter who the speaker sounds like.**

That is the whole point. Impersonating a parent is the attack (level 6 of
BUG-BOUNTY.md), and the target is always minutes. So the rule is not "trust
Tim's voice more", it is "the things worth impersonating for are the things
that get an extra step and a louder notification".

Confirmation is a spoken challenge and a spoken answer:

```
kid:      "Hey Claudia, give Ben thirty more minutes"
claudia:  "Confirm plus thirty minutes for Ben?"
speaker:  "yes"
claudia:  "Done. Thirty minutes added for Ben. Tim's phone has been told."
```

Rules for the confirmation step:

- The confirming utterance is re-scored for speaker identity. If the second
  voice does not match the first, abandon it and log `outcome='denied'`.
  A kid who says "yes" after a recording of Dad has just given the game away.
- Only "yes", "yeah", "yep", "confirm", "do it" count. Silence, a new command
  or anything unparsed is a no. Time out at 20 seconds and log
  `outcome='timed-out'`.
- The confirmation must restate the action in full, including the name and the
  number. "Confirm?" on its own is useless.
- Confirmations never chain. One confirmation authorises one command.

**If the parent push cannot be sent, a time grant does not run.** This is the
one hard interlock in the module. An unwitnessed grant defeats the only real
control there is, so the agent queues nothing and retries nothing: it says
"I can't reach Tim's phone, so I'm not doing that", and writes the row with
`executed=false, notified=false, outcome='error'`. A kid waiting thirty
seconds is a much smaller problem than a grant nobody ever hears about.

Restrictive actions (off, gaming off, media off, dinner, study on) run without
confirmation, and they still notify. Worst case a mistaken "dinner" pauses the
house for a minute and the parent says "ok resume". That asymmetry is
deliberate: the failure modes are not symmetric, so the friction should not be
either.

## Failing safe

The default answer to anything unclear is **do nothing and say so**. There is
no interpretation, no best guess, no "I assumed you meant Ben".

| Situation | What happens | `outcome` |
|---|---|---|
| No intent matched | Say "sorry, I didn't get that". Run nothing. | `no-match` |
| Intent matched, no kid named, and the intent needs one | Ask "for who?" once. No answer, do nothing. | `ambiguous` |
| Two kids plausible ("Ben" vs "Leo" and both are on the roster) | Ask "Ben or Ada?". Never pick. | `ambiguous` |
| A number was needed and did not parse cleanly | Do nothing. Never guess minutes. | `ambiguous` |
| Confirmation not given, or given by a different voice | Do nothing. | `denied` |
| Confirmation timed out | Do nothing. | `timed-out` |
| `kidnet` returned non-zero | Say the failure out loud. Do not retry. | `error` |
| Push could not be sent, on a granting intent | Do not run it. | `error` |
| Wake word fired on the TV | Almost always lands in `no-match`, which is why misfires are cheap | `no-match` |

Two things that follow from this, and are worth stating so nobody optimises
them away later:

- **Never infer a target from context.** "Turn it off" after a sentence about
  Cleo is still ambiguous. The transcript is one utterance, not a
  conversation, and treating it as a conversation is how a mumble becomes an
  hour of somebody's evening.
- **Never expand scope on ambiguity.** If it is unclear whether one kid or all
  of them was meant, the answer is to ask, not to do all of them because that
  is "safer". Cutting three kids off when one was meant is not safe, it is
  just a different mistake, and it teaches the family that the thing is
  unpredictable.

## Sensitive queries

`activity.query` ("what's Cleo been up to") reads domains, never content, and
the spoken reply should say so if it is the first time today: "top sites for
Cleo today were YouTube, Roblox and Khan Academy. I can only see domains, not
what's in the apps." Do not let a voice interface quietly imply more
visibility than the network actually has (docs/AGENT.md).

Never read a self-harm category flag out loud to a room. If the recent
activity includes anything from `flag_domains` with `category='self-harm'`,
the spoken reply omits it and the push to the parent's phone carries it
instead, marked as a care conversation. A kid learning that the kitchen
speaker announces their worst night to whoever is standing there is the exact
opposite of what the safety net is for.

## Speaker identity in the log, not in the decision

`voice_events.speaker_guess` and `speaker_confidence` are recorded on every
row and used for exactly two things:

1. Making the phone notification useful: "sounding like Tim (0.71)" is a much
   better push than "someone".
2. Making the bug bounty legible afterwards: parent and kid can sit down and
   look at the row where the recording scored 0.83.

They are used for **nothing else**. No threshold anywhere in this module
turns a command from refused into allowed. If a future change makes the
confidence score load-bearing, that change has broken the trust model, and
voice/README.md explains why.

## Adding an intent

1. It must map to an existing `kidnet` verb. If it does not, add the verb to
   `kidnet` first, where the tests and the audit trail already are.
2. Decide the direction. Grants access or time: confirmation required. Removes
   access: no confirmation, still notified.
3. Write the phrase variants down here before writing the matcher. If you
   cannot list five ways a tired parent might say it, the intent is not ready.
4. Anything ambiguous fails safe. There are no exceptions to that, and
   "convenience" has never once been a good enough reason to add one.
