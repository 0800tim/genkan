-- Voice audit trail for the "Hey Claudia" module (voice/).
--
-- Every wake-word activation that produces a transcript writes exactly one row
-- here, whether or not it ran anything. Rows where executed=false are the
-- interesting ones: they are the misfires, the refusals and the phrases the
-- grammar did not recognise.
--
-- The trust model, stated plainly (see voice/README.md): speaker_guess is NOT
-- authentication. A recording of a parent played back to the mic will fool the
-- embedding match, and the household bug bounty invites the kids to try it.
-- The real control is this table plus the parent's phone: notified says the
-- push went out, so a grant nobody made is visible within seconds and one tap
-- reverses it. Keep the retention long enough to be useful and short enough to
-- be fair (the reference house keeps 90 days; see voice/README.md).
--
-- No audio is stored. Only the transcript, which is text, and which the parent
-- can read and delete. Voice embeddings live in the voice container's own
-- volume, never in this database and never off the box.
CREATE TABLE IF NOT EXISTS voice_events (
  id                 bigserial PRIMARY KEY,
  ts                 timestamptz NOT NULL DEFAULT now(),
  source             text,            -- which mic: 'kitchen', 'office', 'test'
  transcript         text,            -- what whisper.cpp heard, verbatim
  recognised_intent  text,            -- intent id from voice/intents.md, NULL = no match
  speaker_guess      text,            -- best matching enrolled name, NULL = no match
  speaker_confidence real,            -- 0.0 to 1.0 cosine similarity, NOT a permission
  executed           boolean NOT NULL DEFAULT false,
  executed_command   text,            -- the exact kidnet argv that ran, for replay
  notified           boolean NOT NULL DEFAULT false,  -- parent push actually sent
  outcome            text             -- why not executed: 'no-match' | 'ambiguous'
                                      -- | 'awaiting-confirmation' | 'denied'
                                      -- | 'timed-out' | 'error', or NULL when it ran
);
CREATE INDEX IF NOT EXISTS voice_events_ts_idx ON voice_events (ts DESC);
-- The two questions a parent actually asks: "what did it do for me today" and
-- "did anything grant time while I was out".
CREATE INDEX IF NOT EXISTS voice_events_exec_idx ON voice_events (ts DESC) WHERE executed;

COMMENT ON COLUMN voice_events.speaker_confidence IS
  'similarity to the enrolled voiceprint, 0..1. Advisory only: never a permission check.';
COMMENT ON COLUMN voice_events.notified IS
  'true once the parent push for this action was sent. An executed row with
   notified=false is a fault worth alerting on: the audit trail is the defence.';

-- Last 24 hours in the shape the dashboard and the family agent want to read.
CREATE OR REPLACE VIEW voice_recent AS
SELECT v.id, v.ts, v.source, v.transcript, v.recognised_intent,
       v.speaker_guess, v.speaker_confidence,
       v.executed, v.executed_command, v.notified, v.outcome
FROM voice_events v
WHERE v.ts > now() - interval '24 hours'
ORDER BY v.ts DESC;

-- The voice container connects as the limited kids_app role, the same as the
-- portal and dashboard. It may write its own audit rows and update them when
-- a confirmation lands. It gets no rights over anything else: enforcement is
-- still bin/kidnet, which is the only audited path to the firewall.
GRANT SELECT, INSERT, UPDATE ON voice_events TO kids_app;
GRANT USAGE ON SEQUENCE voice_events_id_seq TO kids_app;
GRANT SELECT ON voice_recent TO kids_app;
