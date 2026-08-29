-- The study lane.
--
-- A child who has run out of time can reach the portal and the quizzes, and
-- nothing else. That makes learn-to-earn a memory test: they can answer what
-- they already know and cannot go and learn anything new. Which is the wrong
-- way round for a feature whose whole point is that effort earns time.
--
-- scope='learn' rows are reachable through a total cut, exactly like the
-- safety net, so a child out of time can go and read. They are separate from
-- scope='safety' because the two promises are different and a parent should be
-- able to reason about them separately: safety is help lines and must never be
-- narrowed, learn is a reading list and is a household's to choose.
--
-- Deliberately short and deliberately dull. Reference and reading, not
-- discussion, not video, not anything with a feed. A child who wants to earn
-- time by learning gets a library, not a way round the block.

INSERT INTO always_allow (domain, scope, category, note) VALUES
  ('wikipedia.org',        'learn', 'reference', 'The obvious one. Reference, no feed, no comments.'),
  ('wikimedia.org',        'learn', 'reference', 'Where Wikipedia''s images and media come from. Without it the articles are text with holes.'),
  ('wiktionary.org',       'learn', 'reference', 'Dictionary.'),
  ('simple.wikipedia.org', 'learn', 'reference', 'Simple English Wikipedia, which is genuinely better for a younger reader.'),
  ('britannica.com',       'learn', 'reference', 'Encyclopaedia.'),
  ('natlib.govt.nz',       'learn', 'reference', 'National Library of New Zealand.'),
  ('teara.govt.nz',        'learn', 'reference', 'Te Ara, the Encyclopedia of New Zealand.'),
  ('doc.govt.nz',          'learn', 'reference', 'Department of Conservation: native species, which is half the natural-history questions.'),
  ('nasa.gov',             'learn', 'science',   'For the astronomy bank, and it is a genuinely good read.'),
  ('esa.int',              'learn', 'science',   'European Space Agency.'),
  ('nhm.ac.uk',            'learn', 'science',   'Natural History Museum.'),
  ('sciencelearn.org.nz',  'learn', 'science',   'Science Learning Hub, written for New Zealand classrooms.'),
  ('mathsisfun.com',       'learn', 'maths',     'Explains the maths banks better than the explanations do.'),
  ('nzta.govt.nz',         'learn', 'reference', 'The actual road code, for the road code bank.'),
  ('drive.govt.nz',        'learn', 'reference', 'Practice road code questions from the source.')
ON CONFLICT (domain) DO UPDATE SET scope = EXCLUDED.scope,
                                   category = EXCLUDED.category,
                                   note = EXCLUDED.note;
