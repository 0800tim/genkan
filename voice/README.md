# Hearth voice: "Hey Claudia"

An optional module. It gives the house an Alexa-shaped thing that answers to
the family instead of to a corporation: a wake word, local speech to text, a
guess at who spoke, and a small grammar that maps what you said onto the same
`bin/kidnet` verbs the phone agent already uses.

Nothing here is required. The core gateway (`compose.yaml` in the repo root)
runs without it, and this stack is a separate compose file for exactly that
reason. If the voice box falls over, the island keeps working.

**No audio leaves the house.** Wake word, transcription and speaker matching
all run on CPU on the gateway box or a satellite Pi. There is no cloud
endpoint, no API key, and nothing to opt out of.

## The shape of it

```
  mic  ->  wake word  ->  record until silence  ->  speech to text
                                                        |
                                     speaker embedding <-+-> transcript
                                                        |
                                                  intent match
                                                        |
                              +-------------------------+-----------------+
                              |                                           |
                       needs confirmation?                          run it now
                              |                                           |
                        ask out loud, wait                          bin/kidnet ...
                              |                                           |
                              +-------------------------+-----------------+
                                                        |
                                        write voice_events row (always)
                                                        |
                                          push to the parent's phone
                                                        |
                                             speak the confirmation (Piper)
```

The last three steps happen for every activation, including the ones that did
nothing. A row that says "heard something, matched nothing, ran nothing" is
worth as much as a row that says "granted Ben 30 minutes".

## Components

| Layer | Choice | Why |
|---|---|---|
| Wake word | openWakeWord, custom "hey claudia" model | CPU only, trainable on synthetic samples, no licence to buy. Porcupine is the fallback if the custom model turns out flaky |
| Speech to text | whisper.cpp, base or small model | Command phrases are short and the vocabulary is tiny. base.en is enough on a modern CPU, small.en if the box has headroom |
| Speaker ID | SpeechBrain ECAPA-TDNN embeddings | Best quality per CPU cycle for "whose voice is this", and the embeddings are small enough to keep in a local volume |
| Text to speech | Piper | Fast, local, decent voices, tiny models |
| Glue | one small container, `voice-agent` | Owns the pipeline, the grammar, the audit write and the push |

### Wyoming protocol

Each stage speaks the Wyoming protocol, which is what Home Assistant's voice
pipeline uses. That is deliberate. It means:

- the pieces are swappable (drop whisper.cpp for faster-whisper, keep the rest)
- a Home Assistant satellite (a Pi with a mic and a speaker, sitting on the
  kitchen bench) works as an input device with no code from us
- if a house already runs Home Assistant, Hearth can be a voice pipeline it
  calls rather than a second thing to maintain

We do not depend on Home Assistant. We just refuse to be incompatible with it.

## Hardware

Two setups worth supporting, in order of effort:

**1. A USB mic on the gateway box.** Cheapest path. Any USB conference mic
with decent far-field pickup. Works if the box lives somewhere people talk,
which in most houses it does not, so treat this as the development setup.

**2. A Pi satellite in the kitchen.** A Pi Zero 2 W or Pi 4, a ReSpeaker
2-mic HAT or a USB conference mic, and a small speaker. It runs
wyoming-satellite: wake word detection happens on the Pi, audio streams to
the gateway box over the LAN for transcription. This is the real deployment.
The kitchen is where "dinner!" gets shouted.

Whichever you use, put the mic where the family already talks, not where the
computer already is. And put a hardware mute switch on it if the model has
one. A mic you can physically kill is worth more than any amount of policy
text about when we listen.

### What it costs to run

whisper.cpp base.en transcribes a two second command in well under a second on
any recent x86 CPU. ECAPA-TDNN embedding extraction is faster than that. The
wake word model runs continuously and costs a few percent of one core. None of
this needs a GPU, and none of it should get one: this box also runs the
firewall the whole house depends on.

## The honest limits

**Speaker ID is not authentication.** It is a guess with a confidence number.
Specifically:

- A recording of a parent, played back to the mic, will match. Phones are
  everywhere and kids are clever. This is not a theoretical attack.
- A sibling with a similar voice will sometimes match, especially across the
  11 to 16 age range where voices are changing month to month.
- A cold, a doorway, a noisy kitchen or a mouth full of toast all drop the
  confidence, so tightening the threshold to stop impersonation mostly just
  stops the family from using it.
- Whisper mishears names. "Ben" and "Leo" and "CO" are all live options. The
  grammar has to resolve against the actual roster in the database, never
  trust the raw string.

So the module is built on the assumption that impersonation succeeds. What
protects the household is not the voiceprint, it is that **every voice action
is written to `voice_events` and pushed to the parent's phone within seconds**:

> +30 min to Ben, granted by voice sounding like Tim (0.71), kitchen mic

A parent who did not say that sees a grant they did not make, and one tap
reverses it. That is the whole design. The voiceprint narrows who probably
spoke; the notification is what actually holds.

There is a second-order rule that falls out of this: if the push cannot be
delivered, the action that would have needed it does not run. An unwitnessed
grant is worse than a kid waiting thirty seconds. See voice/intents.md.

## The Easter egg

Voice impersonation is level 6 of the household bug bounty (BUG-BOUNTY.md).
Playing a recording of Dad to the kitchen mic to get screen time is a *win*
the first time, paid at 30 minutes and capped at three uses. Then the parent
"notices" (they noticed immediately, the phone told them, that is the joke),
the two of them look at the `voice_events` rows together, and the lesson lands
without a lecture: **a voiceprint must never be the only thing guarding
something that matters.** That is a genuinely useful thing for an 11 year old
to understand, and it is a lot more fun to learn this way than from a slide.

Do not "fix" this by cranking the confidence threshold. The fix is the audit
trail, and it is already built.

## Privacy commitments

These are commitments, not aspirations. If a change breaks one, the change is
wrong.

- Audio is never written to disk and never leaves the box. It exists as a
  buffer for the length of one command and is discarded.
- Transcripts are stored, because the parent needs to be able to see what the
  system thought it heard. They are text, in the family's own database, and
  the parent can read and delete them.
- Voice embeddings live in a local docker volume. They never go into Postgres,
  never into a backup that leaves the house, and can be deleted per person at
  any time. See voice/enrolment.md.
- There is no always-on recording, no "improve the service" upload, and no
  telemetry of any kind. The wake word model runs locally and only what
  follows the wake word is ever transcribed.
- Kids get told all of this, in these words, before a mic goes in a room they
  use. A surveillance device the household did not consent to is not a
  parental control, and this project does not build one.

## Retention

The reference house keeps `voice_events` for 90 days, which is long enough to
answer "what happened last month" and short enough that a teenager's offhand
kitchen remarks are not archived for years. Prune with a cron entry or a
systemd timer; there is deliberately no automatic deletion built into the
schema, because a household that wants a shorter window should set it
consciously.

## Status

Scaffold. The design, the grammar, the schema and the compose fragment are
here. The container itself is not written yet. Files:

- `voice/README.md` (this file): architecture, hardware, limits
- `voice/intents.md`: the spoken grammar and the fail-safe rules
- `voice/enrolment.md`: how a family enrols voices, and how to delete them
- `voice/compose.yaml`: the optional service stack
- `config/db/schema-voice.sql`: the `voice_events` audit table

## What this module is NOT allowed to do

It is another client of `bin/kidnet`, with no privileges of its own. It does
not touch nftables, does not talk to AdGuard, does not get its own database
role beyond `kids_app`, and cannot reach the island's network namespace. Every
enforcement path stays the single audited one. If a voice feature ever seems
to need more than `kidnet` can do, the answer is to add the verb to `kidnet`
where the tests and the audit trail already live, not to give the microphone
its own key to the firewall.
