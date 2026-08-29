# Enrolling the family's voices

Enrolment is how the system learns what each person sounds like. It takes
about two minutes per person and it is worth doing properly, because a sloppy
enrolment does not fail loudly, it just quietly mislabels people for months.

Read voice/README.md first if you have not. The short version: this produces a
*guess*, not a login. Nothing in Hearth is unlocked by a voice.

## What actually gets stored

For each enrolled person, one file: a 192-dimension ECAPA-TDNN embedding
vector, averaged over their samples. A few kilobytes.

An embedding is not audio. You cannot play it back and you cannot reconstruct
someone's voice from it in any practical sense. It is a point in a space,
useful only for measuring distance to another point.

**The audio samples are deleted as soon as the embedding is computed.** They
exist for the length of the enrolment run and then they are gone. There is no
setting to keep them, because there is no reason to keep them.

Where it lives:

```
docker volume: hearth-voice_speaker-prints
  /prints/Ada.emb
  /prints/Ben.emb
  /prints/Cleo.emb
  /prints/parent.emb
  /prints/index.json     names, sample counts, enrolment dates
```

Not in Postgres. Not in the repo (the volume is named, never a bind mount into
the working tree, so a voiceprint cannot end up staged for a commit by
accident). Not in any backup that leaves the house. If the box dies, the
family re-enrols, and that is the correct trade: a two minute re-recording is
cheaper than voiceprints sitting in someone else's storage.

## Doing an enrolment

Somewhere quiet, but the room the mic actually lives in. Enrolling in a silent
office for a mic that lives in the kitchen produces a model that works
beautifully in the office.

```
docker compose -f voice/compose.yaml run --rm speakerid enrol Ada
```

It asks for five phrases and records each one:

1. "Hey Claudia, how much time have I got"
2. "Hey Claudia, turn off the gaming"
3. "Hey Claudia, dinner time"
4. "The quick brown fox jumps over the lazy dog"
5. Anything you like, about ten seconds of ordinary talking

Four of the five are real commands, because the point is to match the person
as they actually speak to the thing, not as they perform for a microphone.
The fifth is free speech to catch the rhythm of ordinary conversation.

Then:

```
docker compose -f voice/compose.yaml run --rm speakerid list
docker compose -f voice/compose.yaml run --rm speakerid test
```

`list` shows who is enrolled and when. `test` records one phrase and tells you
who it thinks that was, with a score. Do this with each family member standing
where they normally stand. Two people who consistently score close to each
other is useful information, and the answer is more samples, not a higher
threshold.

## Enrolling the kids too, and why

Enrol Ada, Ben and Cleo alongside the parents. Not to restrict them: to
make the log truthful.

The difference between these two rows matters:

```
transcript: "give Ben thirty more minutes"   speaker_guess: NULL
transcript: "give Ben thirty more minutes"   speaker_guess: Ben (0.88)
```

The first says someone asked. The second says Ben asked for Ben, which is a
much more interesting notification for a parent to receive, and a much better
conversation to have. Without the kids enrolled, every unmatched voice looks
identical and the audit trail loses most of its value.

Kids also get to use it. "Hey Claudia, how much time have I got" is the single
most-used phrase in a house like this, and a kid asking should get a straight
answer without going through a parent. That only works if the system knows who
is asking.

What a kid's enrolment does **not** do:

- It does not grant them anything. Every granting intent needs spoken
  confirmation regardless of who is speaking (voice/intents.md).
- It does not stop them impersonating a parent. It is not meant to. See the
  bug bounty note below.
- It does not identify them anywhere except in `voice_events`, which their
  parent can read and which they can ask to see.

## Telling the kids, before the mic goes in

Do this properly, out loud, before a microphone is in a room they use. The
whole project rests on the household consenting to what is in it, and a mic
they did not agree to is surveillance no matter whose house it is.

What they should be told, in roughly these words:

- It only listens for "hey Claudia". Nothing else is recorded or sent anywhere.
- No audio is ever kept, and nothing ever leaves the house.
- What you say to it after the wake word is written down as text, and Dad can
  read that list. So can you, any time you ask.
- It knows your voice. It cannot read your messages, and neither can the
  network.
- There is a mute switch, and using it is allowed.

If anyone in the house does not want to be enrolled, do not enrol them. The
system copes: an unmatched voice logs `speaker_guess = NULL`, everything still
works, and the notification says "someone" instead of a name. That is a small
loss and it is theirs to choose.

## Deleting a voiceprint

Any time, no reason needed, and it takes effect immediately:

```
docker compose -f voice/compose.yaml run --rm speakerid forget Ben
```

Deletes `/prints/Ben.emb` and its `index.json` entry. Ben's voice is then
unrecognised: commands still work, they just log as `NULL`. Nothing else
breaks.

To wipe every voiceprint in the house:

```
docker compose -f voice/compose.yaml down
docker volume rm hearth-voice_speaker-prints
```

Historical `voice_events` rows keep the name they were labelled with at the
time. That is on purpose: an audit trail you can retroactively rewrite is not
an audit trail. If a parent wants those rows gone too, delete the rows, which
is a plain `DELETE` on `voice_events` and their own database to run it on.

## Re-enrolling

Voices change, and the 11 to 14 range is where they change fastest. Cleo's
enrolment at 11 will be quietly wrong by 12. Signs it is time:

- an increase in `speaker_guess IS NULL` rows for someone who used to match
- confidences drifting down over weeks
- siblings starting to score close to each other

Re-enrolling is the same command as enrolling. It replaces the old embedding
outright rather than averaging into it, because averaging a broken voice with
a settled one gives you a model of neither.

Put a re-enrolment in the calendar every six months while there are teenagers
in the house. It is two minutes and it keeps the log honest.

## About the bug bounty

Level 6 is beating the speaker ID with a recording, and it works, and that is
fine (BUG-BOUNTY.md, voice/README.md). Enrolment quality is not what stops it,
and no amount of extra samples will. What stops the damage is the
`voice_events` row and the push to the parent's phone.

So do not respond to a successful impersonation by tightening the threshold.
That makes the system worse at its actual job, which is labelling the log
accurately, and it does not close the hole. The hole is not closeable with a
microphone, which is precisely the thing the level is there to teach.
