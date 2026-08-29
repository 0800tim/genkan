-- always_allow.scope: two different promises, which used to be conflated.
--
--   'safety'   Survives EVERYTHING: a total cut (kidnet off), dinner, bedtime,
--              out-of-time. These are the NZ youth help lines and schoolwork.
--              Enforced in the firewall via the nft set @kids_allow, loaded by
--              `kidnet allow-sync`. A kid who is switched off can still reach
--              1737 and still hand in their homework.
--
--   'category' Survives a CATEGORY block only (study mode, media off, gaming
--              off). Spotify is the case that matters: singing along while
--              studying is fine, so audio outlives 'media off'. It does NOT
--              outlive dinner. Enforced at the DNS/AdGuard layer, never in
--              @kids_allow.
--
-- Getting this wrong is the difference between "dinner, everyone off" and
-- "dinner, and the music keeps playing".

ALTER TABLE always_allow ADD COLUMN IF NOT EXISTS category text;

UPDATE always_allow SET scope='category', category='audio'
 WHERE domain IN ('spotify.com','scdn.co','spotifycdn.com','music.apple.com');

UPDATE always_allow SET scope='safety', category='help'
 WHERE domain IN ('1737.org.nz','youthline.co.nz','kidsline.org.nz',
                  'thelowdown.co.nz','sparklers.org.nz');

UPDATE always_allow SET scope='safety', category='schoolwork'
 WHERE domain IN ('khanacademy.org','education.govt.nz','drive.google.com',
                  'docs.google.com','classroom.google.com');

-- Anything added later without a decision defaults to the cautious side:
-- category-only, so a new domain can never silently punch through a full cut.
ALTER TABLE always_allow ALTER COLUMN scope SET DEFAULT 'category';
