-- Community learning packages: a quiz bank somebody else wrote, with its
-- author, its licence and optionally something to read first.
--
-- The point of this file, in one paragraph. A quiz bank is a good unit of
-- teaching and a bad unit of sharing: a bare JSON file of questions carries
-- no author, no licence, no word about who it is for, and nothing a person
-- could read before they have a go. A package is that same bank with a small
-- manifest bolted on, so a stranger can write one, put it in a pull request
-- or email it, and a household can install it and know where it came from.
-- The examples that drove this were model aeroplanes and painting: valuable,
-- teachable, and on nobody's curriculum. Those are first-class here.
--
-- An installed package lives in the DATABASE, exactly like a bank a parent
-- wrote on the dashboard, and for the same reason: portal/quizzes is tracked
-- in git, so a `git pull` would delete a family's installed content. The bank
-- half goes into quiz_banks / quiz_bank_questions (schema-quizbanks.sql) and
-- is served by the portal with no special handling at all. This file adds
-- only the manifest, one row per installed package, keyed to the bank.
--
-- Load order: after schema-quizbanks.sql, which creates quiz_banks and
-- quiz_bank_summary. Idempotent, safe to re-run.
--
-- What this file does NOT do, said plainly because the gaps matter:
--   * It does not validate anything. tools/validate-package.mjs is the gate
--     and bin/kidnet-pack refuses to install a package that does not pass it.
--     The constraints below are the second lock, not the first.
--   * It stores no images and no video. read_first is text and links, and a
--     link may only point at a domain already on the reading list
--     (config/db/schema-learn.sql), because those are the only ones a child
--     who has run out of time can actually reach. docs/CONTRIBUTING-CONTENT.md
--     explains what pictures would take, and why they are not done.
--   * Nothing here reaches the network, phones home or fetches a package. A
--     package arrives as a file, put there by a person.

-- ---------------------------------------------------------------------------
-- The manifest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_packages (
  bank_id        text PRIMARY KEY REFERENCES quiz_banks(id) ON DELETE CASCADE,
  format         int  NOT NULL DEFAULT 1,      -- package format version, currently 1
  author         text NOT NULL,                -- who wrote it, as they want to be credited
  contact        text,                         -- optional: a handle, an email, a URL
  licence        text NOT NULL,                -- one of the four below
  description    text,                         -- who it is for and what they get out of it
  tags           text[] NOT NULL DEFAULT '{}', -- free words: 'making', 'art', 'outdoors'
  homepage       text,
  sources        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- what the author checked against
  read_first     jsonb,                        -- {title, body:[para], links:[{label,url}]} or NULL
  updated_on     date,                         -- the author's own "last checked" date
  installed_from text,                         -- the filename it was installed from
  installed_by   text,
  installed_ts   timestamptz NOT NULL DEFAULT now(),
  checksum       text,                         -- sha256 of the file, so a re-install is visible
  CONSTRAINT quiz_packages_format_ck  CHECK (format = 1),
  CONSTRAINT quiz_packages_author_ck  CHECK (length(btrim(author)) BETWEEN 1 AND 80),
  CONSTRAINT quiz_packages_contact_ck CHECK (contact IS NULL OR length(contact) <= 120),
  CONSTRAINT quiz_packages_desc_ck    CHECK (description IS NULL OR length(description) <= 600),
  CONSTRAINT quiz_packages_tags_ck    CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 8),
  CONSTRAINT quiz_packages_sources_ck CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 12),
  CONSTRAINT quiz_packages_read_ck    CHECK (read_first IS NULL OR jsonb_typeof(read_first) = 'object'),
  -- A short allowlist on purpose. Every one of these lets a household install
  -- the package, keep it, and change it for their own kids without asking
  -- anybody. A licence that does not allow all three is not shareable content,
  -- it is somebody else's product. docs/CONTRIBUTING-CONTENT.md has the why.
  CONSTRAINT quiz_packages_licence_ck CHECK (licence IN ('CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT'))
);

CREATE INDEX IF NOT EXISTS quiz_packages_installed_idx ON quiz_packages (installed_ts DESC);

-- One row per installed package, with the bank's own numbers alongside the
-- manifest, so the dashboard and kidnet-pack can both answer "what is on this
-- box, who wrote it, and is it live" in a single query.
DROP VIEW IF EXISTS quiz_package_summary;
CREATE VIEW quiz_package_summary AS
SELECT p.bank_id, p.author, p.contact, p.licence, p.description, p.tags,
       p.homepage, p.sources, p.updated_on, p.installed_from, p.installed_by,
       p.installed_ts, p.checksum,
       (p.read_first IS NOT NULL) AS has_read_first,
       b.title, b.emoji, b.suggested_age_min, b.minutes_per_pass, b.pass_mark,
       b.questions_per_round, b.active, b.source_note,
       s.questions, s.labelled,
       (b.active AND s.questions >= b.questions_per_round) AS live
FROM quiz_packages p
JOIN quiz_banks b        ON b.id = p.bank_id
JOIN quiz_bank_summary s ON s.id = p.bank_id;

-- ---------------------------------------------------------------------------
-- Installing and removing, as two functions
-- ---------------------------------------------------------------------------
-- bin/kidnet-pack hands the whole validated package in as one jsonb value and
-- calls install_quiz_package. Doing it here rather than as a script full of
-- INSERT statements buys three things: the install is atomic, so a package can
-- never land half in; the content never goes near string building in bash or
-- python, so there is one value to quote instead of hundreds; and the
-- constraints in schema-quizbanks.sql apply to a stranger's content exactly as
-- they apply to a bank a parent typed.
--
-- SECURITY DEFINER, and that is the point rather than a shortcut. It means
-- kids_agent (config/db/grants.sql, the least-privilege role the CLI uses) can
-- install a package WITHOUT being given INSERT, UPDATE and DELETE on
-- quiz_banks and quiz_bank_questions. The role gets one narrow, audited
-- operation instead of open write access to the whole quiz shelf. search_path
-- is pinned so a caller cannot point the function at tables of their own.
--
-- Installing REPLACES the bank's questions. Re-installing a newer version of a
-- package is the normal path and it should leave the bank holding what the
-- file says, not the union of two versions. Children's results are untouched:
-- they live in quiz_rounds and quiz_answers, which have no foreign key to the
-- bank, so a child keeps every minute they earned even from a question that no
-- longer exists.
CREATE OR REPLACE FUNCTION install_quiz_package(p jsonb, from_file text DEFAULT NULL,
                                                by_whom text DEFAULT NULL, sha text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bid text := p->>'id';
  m   jsonb := COALESCE(p->'package', '{}'::jsonb);
  n   int;
BEGIN
  IF bid IS NULL OR bid !~ '^[a-z0-9-]{1,48}$' THEN
    RAISE EXCEPTION 'install_quiz_package: bad or missing package id';
  END IF;
  IF jsonb_typeof(p->'questions') <> 'array' THEN
    RAISE EXCEPTION 'install_quiz_package: % has no questions array', bid;
  END IF;
  -- A bank that is already here but is NOT a package belongs to the household:
  -- a parent wrote it on the dashboard. Overwriting it from a file would throw
  -- away their work without asking, so refuse and let kidnet-pack explain.
  IF EXISTS (SELECT 1 FROM quiz_banks WHERE id = bid)
     AND NOT EXISTS (SELECT 1 FROM quiz_packages WHERE bank_id = bid) THEN
    RAISE EXCEPTION 'install_quiz_package: % is a bank this household wrote, not a package', bid;
  END IF;

  INSERT INTO quiz_banks (id, title, emoji, suggested_age_min, minutes_per_pass,
                          pass_mark, questions_per_round, source_note, active, created_by)
  VALUES (bid,
          p->>'title',
          p->>'emoji',
          (p->>'suggested_age_min')::int,
          COALESCE((p->>'minutes_per_pass')::int, 10),
          COALESCE((p->>'pass_mark')::int, 8),
          COALESCE((p->>'questions_per_round')::int, 10),
          NULLIF(btrim(COALESCE(m->>'description', '')
                 || CASE WHEN m ? 'author' THEN ' (package by ' || (m->>'author') || ')' ELSE '' END), ''),
          true,
          'package')
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, emoji = EXCLUDED.emoji,
    suggested_age_min = EXCLUDED.suggested_age_min,
    minutes_per_pass = EXCLUDED.minutes_per_pass,
    pass_mark = EXCLUDED.pass_mark,
    questions_per_round = EXCLUDED.questions_per_round,
    source_note = EXCLUDED.source_note,
    active = true,
    updated_ts = now();

  DELETE FROM quiz_bank_questions WHERE bank_id = bid;
  INSERT INTO quiz_bank_questions (bank_id, question_id, seq, prompt, choices,
                                   answer_index, difficulty, explanation)
  SELECT bid, q->>'id', ord::int, q->>'prompt', q->'choices',
         (q->>'answer_index')::int,
         NULLIF(q->>'difficulty', '')::int,
         NULLIF(q->>'explanation', '')
  FROM jsonb_array_elements(p->'questions') WITH ORDINALITY AS t(q, ord);
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO quiz_packages (bank_id, format, author, contact, licence, description,
                             tags, homepage, sources, read_first, updated_on,
                             installed_from, installed_by, checksum)
  VALUES (bid,
          COALESCE((m->>'format')::int, 1),
          COALESCE(NULLIF(btrim(COALESCE(m->>'author', '')), ''), 'unattributed'),
          m->>'contact',
          COALESCE(NULLIF(m->>'licence', ''), NULLIF(m->>'license', ''), 'CC-BY-4.0'),
          m->>'description',
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(m->'tags')), '{}'::text[]),
          m->>'homepage',
          COALESCE(m->'sources', '[]'::jsonb),
          m->'read_first',
          NULLIF(m->>'updated', '')::date,
          from_file, by_whom, sha)
  ON CONFLICT (bank_id) DO UPDATE SET
    format = EXCLUDED.format, author = EXCLUDED.author, contact = EXCLUDED.contact,
    licence = EXCLUDED.licence, description = EXCLUDED.description, tags = EXCLUDED.tags,
    homepage = EXCLUDED.homepage, sources = EXCLUDED.sources,
    read_first = EXCLUDED.read_first, updated_on = EXCLUDED.updated_on,
    installed_from = EXCLUDED.installed_from, installed_by = EXCLUDED.installed_by,
    installed_ts = now(), checksum = EXCLUDED.checksum;

  RETURN bid || ': ' || n || ' questions installed';
END;
$$;

-- Removing one. It will only ever touch a bank that came in as a package, so
-- it cannot delete a bank a parent wrote on the dashboard even if somebody
-- passes its id. Set live_only to true to take a package off the kids' list
-- without deleting it.
CREATE OR REPLACE FUNCTION remove_quiz_package(bid text, keep boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  rounds int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quiz_packages WHERE bank_id = bid) THEN
    RAISE EXCEPTION 'remove_quiz_package: % is not an installed package', bid;
  END IF;
  SELECT count(*)::int INTO rounds FROM quiz_rounds WHERE bank_id = bid;
  IF keep THEN
    UPDATE quiz_banks SET active = false, updated_ts = now() WHERE id = bid;
    RETURN bid || ': off the list, still installed (' || rounds || ' rounds in the history)';
  END IF;
  -- The manifest and the questions go with the bank, by cascade. quiz_rounds
  -- and quiz_answers do not: no foreign key points at quiz_banks, so every
  -- minute a child earned from this stays earned and stays in the ledger.
  DELETE FROM quiz_banks WHERE id = bid;
  RETURN bid || ': removed (' || rounds || ' rounds stay in the history)';
END;
$$;

-- ---------------------------------------------------------------------------
-- Who may do what
-- ---------------------------------------------------------------------------
-- Nobody gets these functions by default. Installing a stranger's content is a
-- deliberate act at a terminal, not something an HTTP request can do, so
-- kids_app (the dashboard and the portal) is given SELECT and nothing else.
REVOKE ALL ON FUNCTION install_quiz_package(jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_quiz_package(text, boolean)            FROM PUBLIC;

-- The dashboard lists what is installed and who wrote it. It never writes here.
GRANT SELECT ON quiz_packages        TO kids_app;
GRANT SELECT ON quiz_package_summary TO kids_app;

-- kids_agent is the least-privilege role bin/ connects as (config/db/grants.sql).
-- It is granted the two functions and nothing else: no table writes on the quiz
-- shelf are added anywhere by this file. Guarded, because an install that has
-- not loaded grants.sql yet has no such role and this file must still load.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kids_agent') THEN
    EXECUTE 'GRANT SELECT ON quiz_packages        TO kids_agent';
    EXECUTE 'GRANT SELECT ON quiz_package_summary TO kids_agent';
    EXECUTE 'GRANT EXECUTE ON FUNCTION install_quiz_package(jsonb, text, text, text) TO kids_agent';
    EXECUTE 'GRANT EXECUTE ON FUNCTION remove_quiz_package(text, boolean) TO kids_agent';
  END IF;
END $$;
