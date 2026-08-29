-- The study lane, extended past the fifteen sites in schema-learn.sql.
--
-- schema-learn.sql set the rule: deliberately short, deliberately dull.
-- Reference and reading, not discussion, not video, not anything with a
-- feed. This file applies the same rule to the sites that children and
-- teenagers in New Zealand, Australia, the United Kingdom and the United
-- States actually use for schoolwork: the official curriculum bodies, the
-- free study resources, the national libraries and museums, and the
-- science agencies. Do not add a domain here without checking it against
-- that rule first. docs/READING-LIST.md has the full research, including
-- the sites that were rejected and why.
--
-- Two things ruled out more candidates than anything else. Video-first
-- sites: several well-known school resources (BBC Bitesize, ABC Education,
-- PBS LearningMedia) describe themselves, in their own marketing, as video
-- libraries first and reading material second, so they failed the test
-- this list exists to apply. And sites that are really a search engine or
-- aggregator wearing a library's name, such as Trove, which is built to
-- search across the open web and not just a library's own holdings.
--
-- khanacademy.org is deliberately not repeated here. It already sits in
-- always_allow with scope='safety' (config/db/seed.sql), and re-inserting
-- it with scope='learn' would narrow its promise, not widen it. Do not add
-- it to this file.
--
-- Several of these need a specific subdomain, not the bare domain, because
-- that is genuinely where the content lives and the two resolve to
-- different addresses. Te Papa is the clearest case: the site at
-- tepapa.govt.nz and the object database at collections.tepapa.govt.nz
-- are on different IPs, so both are listed.

INSERT INTO always_allow (domain, scope, category, note) VALUES

  -- New Zealand -----------------------------------------------------------
  ('www2.nzqa.govt.nz',                 'learn', 'reference', 'NZQA''s subject and assessment pages, which a student preparing for NCEA reads directly. Login is only needed for the personal results portal, not for reading a subject page.'),
  ('tahurangi.education.govt.nz',       'learn', 'reference', 'The Ministry of Education''s curriculum resource platform, replacing Te Kete Ipurangi (tki.org.nz), which is being retired onto this site.'),
  ('nzhistory.govt.nz',                 'learn', 'history',   'NZ History, from the Ministry for Culture and Heritage: a calendar of events and a dictionary of biography, text and no feed.'),
  ('aotearoahistories.education.govt.nz','learn', 'history',  'Aotearoa New Zealand''s Histories, the curriculum topic every school has had to teach since 2023, and a natural search target for the history bank.'),
  ('tepapa.govt.nz',                    'learn', 'reference', 'Te Papa''s learning and collections landing pages.'),
  ('collections.tepapa.govt.nz',        'learn', 'reference', 'Te Papa''s object database, on a different address to tepapa.govt.nz. Without this the collection pages load with the objects missing.'),

  -- Australia ---------------------------------------------------------------
  ('australiancurriculum.edu.au',       'learn', 'reference', 'The Australian Curriculum itself, published by ACARA. The national syllabus every Australian school works from.'),
  ('educationstandards.nsw.edu.au',     'learn', 'reference', 'NESA, the NSW curriculum and HSC syllabus authority, added as the representative state body. Other states run their own (VCAA in Victoria, QCAA in Queensland); add one if your household needs it.'),
  ('csiro.au',                          'learn', 'science',   'CSIRO, Australia''s national science agency, and a genuinely good read on real research.'),
  ('ga.gov.au',                         'learn', 'science',   'Geoscience Australia: earthquakes, geology and maps, from the source.'),
  ('bom.gov.au',                        'learn', 'science',   'The Bureau of Meteorology, for the weather and climate half of the science bank.'),
  ('library.gov.au',                    'learn', 'reference', 'The National Library of Australia, now serving its site from this address rather than nla.gov.au.'),
  ('australian.museum',                 'learn', 'science',   'The Australian Museum''s fact sheets on fossils, animals and minerals, written for students and teachers.'),
  ('naa.gov.au',                        'learn', 'history',   'The National Archives of Australia, for primary sources and historical records.'),

  -- United Kingdom ----------------------------------------------------------
  ('nationalarchives.gov.uk',           'learn', 'history',   'The National Archives: primary sources and historical records, the UK equivalent of naa.gov.au and archives.gov.'),
  ('bl.uk',                             'learn', 'reference', 'The British Library.'),
  ('rmg.co.uk',                         'learn', 'science',   'Royal Museums Greenwich, home of the Royal Observatory: astronomy and navigation, written well.'),
  ('nrich.maths.org',                   'learn', 'maths',     'The University of Cambridge''s free maths problem sets, open to everyone with no account needed, a different style of explanation to mathsisfun.com and a genuinely good complement to it.'),
  ('nationalgallery.org.uk',            'learn', 'reference', 'The National Gallery''s collection pages. Its shop is a separate subdomain (shop.nationalgallery.org.uk) and is not included here.'),
  ('stem.org.uk',                       'learn', 'science',   'STEM Learning UK''s open-access resource library, aligned to the English National Curriculum. An account is only needed to save favourites, not to read a resource.'),

  -- United States -------------------------------------------------------------
  ('loc.gov',                           'learn', 'reference', 'The Library of Congress, including its research guides written specifically for middle and high school students.'),
  ('learninglab.si.edu',                'learn', 'reference', 'The Smithsonian Learning Lab: a million museum objects and specimens, free to browse with no account needed. An account is only required to save a collection.'),
  ('noaa.gov',                          'learn', 'science',   'NOAA, the source for weather, ocean and atmosphere questions.'),
  ('www.usgs.gov',                      'learn', 'science',   'The US Geological Survey, for geology, earthquakes and water. The bare domain usgs.gov does not resolve; this address does.'),
  ('archives.gov',                      'learn', 'history',   'The US National Archives, for primary sources and historical records.'),
  ('merriam-webster.com',               'learn', 'reference', 'The standard American dictionary. Its free tier carries ordinary banner ads, not the aggressive, child-targeted kind, and no account is needed to look up a word.')

ON CONFLICT (domain) DO UPDATE SET scope = EXCLUDED.scope,
                                   category = EXCLUDED.category,
                                   note = EXCLUDED.note;
