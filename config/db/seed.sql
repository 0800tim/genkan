INSERT INTO policies (tier, description, block_categories, safesearch, youtube_restricted, force_dns, daily_budget_school_min, daily_budget_weekend_min) VALUES
 ('young','Age ~11: tight. Block adult/gambling/drugs/self-harm/dating/violence; SafeSearch + YouTube restricted forced; strict bedtime; time budget.',
   ARRAY['adult','gambling','drugs','self-harm','dating','weapons','violence','proxy-vpn'], true, true, true, 90, 180),
 ('standard','Age ~14: block genuinely harmful categories, keep social but monitored; SafeSearch on; later bedtime.',
   ARRAY['adult','gambling','drugs','self-harm','weapons','proxy-vpn'], true, true, true, 120, 240),
 ('teen','Age ~16: light touch + transparency. Block the seriously harmful only; focus on time + safety alerts, not heavy filtering.',
   ARRAY['adult-extreme','self-harm','drugs','proxy-vpn'], false, false, true, NULL, NULL)
ON CONFLICT (tier) DO NOTHING;

-- Names are placeholders; the household confirms real names and ages later.
INSERT INTO children (name, age, policy_tier, notes) VALUES
 ('child-11', 11, 'young',    'youngest; strictest tier'),
 ('child-14', 14, 'standard', 'middle'),
 ('child-16', 16, 'teen',     'eldest; light touch + transparency, per plan')
ON CONFLICT (name) DO NOTHING;

-- Domains that must survive a block. Two different promises, see
-- schema-safety.sql: scope='safety' survives EVERYTHING (a full cut, dinner,
-- bedtime, out of time); scope='category' only survives a category block
-- (Spotify outlives 'media off' and study mode, but not dinner).
INSERT INTO always_allow (domain, scope, category, note) VALUES
 ('1737.org.nz',        'safety','help','NZ Need to Talk counselling'),
 ('youthline.co.nz',    'safety','help','Youthline'),
 ('kidsline.org.nz',    'safety','help','Kidsline'),
 ('thelowdown.co.nz',   'safety','help','youth mental health'),
 ('sparklers.org.nz',   'safety','help','wellbeing'),
 ('khanacademy.org',    'safety','schoolwork','education'),
 ('education.govt.nz',  'safety','schoolwork','education'),
 ('drive.google.com',   'safety','schoolwork','schoolwork'),
 ('docs.google.com',    'safety','schoolwork','schoolwork'),
 ('classroom.google.com','safety','schoolwork','schoolwork'),
 ('spotify.com',        'category','audio','audio - stays on during study/media-off, NOT during dinner'),
 ('scdn.co',            'category','audio','Spotify CDN'),
 ('spotifycdn.com',     'category','audio','Spotify CDN'),
 ('music.apple.com',    'category','audio','audio')
ON CONFLICT (domain) DO NOTHING;

-- Earnable chores. Without these the portal's "earn time" buttons and
-- `kidnet earn` have nothing to offer, so a fresh install looks broken.
-- Families should edit these to match their own household.
INSERT INTO tasks (name, minutes, needs_approval, active) VALUES
 ('Dishes done',        30, true,  true),
 ('Room tidy',          20, true,  true),
 ('Homework finished',  45, true,  true),
 ('20 min reading',     20, true,  true),
 ('Study quiz (unrot)', 15, false, true)
ON CONFLICT (lower(name)) DO NOTHING;
