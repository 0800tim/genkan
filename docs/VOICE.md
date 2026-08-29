# Voice design: "Hey Claudia"

Status: designed and specified, no code yet. What exists is `voice/`: a
separate compose file, an intent grammar (`voice/intents.md`), an enrolment
guide (`voice/enrolment.md`) and the `voice_events` audit table
(`config/db/schema-voice.sql`). The containers it describes are not written.

The phone-chat agent is the primary interface and always will be; open-mic
voice is an optional module for houses that want an Alexa replacement that
answers to the family instead of a corporation. Nothing in the core stack
references it, and if the whole `voice/` directory were deleted the island
would run exactly as before.

## Stack (all local, all containerised, no audio leaves the house)

| Layer | Candidate | Notes |
|---|---|---|
| Wake word | openWakeWord (custom "hey claudia" model) | runs on CPU; Porcupine as fallback |
| Speech to text | whisper.cpp (small/base model) | fine for command phrases |
| Speaker ID | ECAPA-TDNN embeddings (SpeechBrain) | "whose voice is this": enrolment per family member |
| Text to speech | Piper | fast local voices |
| Glue | one voice container joining the agent | emits kidnet commands + alerts |

The Wyoming protocol (Home Assistant's voice pipeline) fits this shape
well and keeps the door open to reusing HA's ecosystem of satellites
(a Pi with a mic in the kitchen).

## The trust model, stated honestly

Speaker recognition is NOT authentication. A recording of Dad played back
will fool it, and we do not pretend otherwise. The real control is the
audit trail: every voice-granted action notifies the parent's phone
immediately ("+30 min to Ben, granted by voice sounding like a parent,
kitchen mic"). Parent sees a grant they did not make, one tap reverses it.

## The Easter egg (by design)

Voice impersonation is bug-bounty content, not a shameful hole:
- Level 6: replay Dad's voice to get time. First success is REWARDED
  (the reference house pays 30 minutes, up to three uses), then the
  parent "notices", the gap is discussed and closed together, and the kid
  is sent off on the next level. The lesson inside the fun: this is
  exactly why voiceprints alone must never guard anything that matters.

## Interfaces

The voice container translates recognised commands into the same kidnet
verbs the chat agent uses (docs/AGENT.md table), inserts a voice_events
audit row (who it thinks spoke, confidence, transcript), and posts the
phone notification. No new privileges: it is just another client of the
same audited control surface.
