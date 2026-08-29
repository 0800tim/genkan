-- Per-SERVICE traffic accounting (YouTube, Netflix, TikTok, Roblox, ...).
--
-- Why this can work at all: we are the DNS server, so when a device resolves
-- googlevideo.com we learn which IPs belong to YouTube and can then count
-- BYTES to those IPs in the firewall, without decrypting anything. That gives
-- a real data-volume figure per service per device, not a guess.
--
-- Honest limits, which the dashboard must state:
--  * Services sharing infrastructure blur together (YouTube and other Google
--    video ride the same CDN names; YouTube Music counts as YouTube).
--  * A CDN address serving several services attributes to whichever service
--    resolved it most recently for that device.
--  * A VPN hides destinations entirely, so its traffic is uncategorised.
--  * Bytes are not minutes. Both are reported; neither is the whole story.

CREATE TABLE IF NOT EXISTS services (
  id       serial PRIMARY KEY,
  name     text NOT NULL UNIQUE,       -- youtube | netflix | tiktok | roblox ...
  label    text NOT NULL,              -- "YouTube", "Netflix"
  category text NOT NULL,              -- video | gaming | social | audio | schoolwork
  emoji    text,
  metered  boolean NOT NULL DEFAULT true
);

-- Domain suffixes that identify a service. Matched as a suffix of the
-- looked-up name, longest match wins.
CREATE TABLE IF NOT EXISTS service_domains (
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  domain     text NOT NULL,
  PRIMARY KEY (service_id, domain)
);

-- IPs learned from DNS answers, per service. TTL'd by `seen`.
CREATE TABLE IF NOT EXISTS service_ips (
  ip         inet NOT NULL,
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  seen       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, service_id)
);
CREATE INDEX IF NOT EXISTS service_ips_seen ON service_ips(seen);

-- Daily rollup per child per service: real bytes from the firewall counters,
-- plus active minutes on the same threshold rule the category meter uses.
CREATE TABLE IF NOT EXISTS service_usage (
  child_id   int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day        date NOT NULL,
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  bytes      bigint NOT NULL DEFAULT 0,
  used_min   int NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day, service_id)
);

INSERT INTO services (name,label,category,emoji,metered) VALUES
 ('youtube','YouTube','video','📺',true),
 ('netflix','Netflix','video','🎬',true),
 ('disneyplus','Disney+','video','🏰',true),
 ('primevideo','Prime Video','video','📦',true),
 ('tiktok','TikTok','video','🎵',true),
 ('twitch','Twitch','video','🎮',true),
 ('instagram','Instagram','social','📸',true),
 ('snapchat','Snapchat','social','👻',true),
 ('roblox','Roblox','gaming','🧱',true),
 ('fortnite','Fortnite','gaming','🔫',true),
 ('steam','Steam','gaming','🎯',true),
 ('minecraft','Minecraft','gaming','⛏️',true),
 ('spotify','Spotify','audio','🎧',false),
 ('khanacademy','Khan Academy','schoolwork','📚',false),
 ('googleclassroom','Google Classroom','schoolwork','🎓',false),
 -- Added because they are what a family actually uses. A service is metered
 -- when we want its BYTES named on the live view; the time budget is per
 -- CATEGORY, so a metered messaging or audio service is measured and labelled
 -- without ever costing a child a minute (METERING.md).
 ('facebook','Facebook','social','👍',true),
 ('x','X','social','✖️',true),
 ('reddit','Reddit','social','👽',true),
 ('discord','Discord','social','💬',true),
 ('pinterest','Pinterest','social','📌',true),
 ('whatsapp','WhatsApp','messaging','💬',true),
 ('telegram','Telegram','messaging','✈️',true),
 ('playstation','PlayStation','gaming','🎮',true),
 ('xbox','Xbox','gaming','🟩',true),
 ('nintendo','Nintendo','gaming','🍄',true),
 ('riot','Riot Games','gaming','⚔️',true),
 ('battlenet','Battle.net','gaming','❄️',true),
 ('applemusic','Apple Music','audio','🍎',false),
 ('soundcloud','SoundCloud','audio','🔊',false),
 ('duolingo','Duolingo','schoolwork','🦉',false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO service_domains (service_id, domain)
SELECT s.id, d.domain FROM (VALUES
 ('youtube','youtube.com'),('youtube','googlevideo.com'),('youtube','ytimg.com'),('youtube','youtu.be'),('youtube','youtube-nocookie.com'),
 ('netflix','netflix.com'),('netflix','nflxvideo.net'),('netflix','nflxso.net'),('netflix','nflximg.net'),
 ('disneyplus','disneyplus.com'),('disneyplus','disney-plus.net'),('disneyplus','dssott.com'),
 ('primevideo','primevideo.com'),('primevideo','aiv-cdn.net'),('primevideo','avodmp4s3ww-a.akamaihd.net'),
 ('tiktok','tiktok.com'),('tiktok','tiktokcdn.com'),('tiktok','byteoversea.com'),('tiktok','ibytedtos.com'),
 ('twitch','twitch.tv'),('twitch','ttvnw.net'),('twitch','jtvnw.net'),
 ('instagram','instagram.com'),('instagram','cdninstagram.com'),
 ('snapchat','snapchat.com'),('snapchat','sc-cdn.net'),('snapchat','snap.com'),
 ('roblox','roblox.com'),('roblox','rbxcdn.com'),('roblox','robloxlabs.com'),
 ('fortnite','fortnite.com'),('fortnite','epicgames.com'),('fortnite','unrealengine.com'),
 ('steam','steampowered.com'),('steam','steamcommunity.com'),('steam','steamstatic.com'),
 ('minecraft','minecraft.net'),('minecraft','minecraftservices.com'),
 ('spotify','spotify.com'),('spotify','scdn.co'),('spotify','spotifycdn.com'),
 ('khanacademy','khanacademy.org'),('khanacademy','kastatic.org'),
 ('googleclassroom','classroom.google.com'),
 -- The CDN names matter more than the front door: the front door is a few
 -- kilobytes of HTML, the CDN is the gigabytes. Longest suffix wins, so a
 -- download CDN sitting under a service's own domain still resolves to the
 -- download CATEGORY in category_domains while staying named as that service
 -- here.
 ('youtube','yt3.ggpht.com'),('youtube','youtubei.googleapis.com'),
 ('netflix','nflxext.com'),
 ('primevideo','aiv-delivery.net'),
 ('tiktok','tiktokv.com'),('tiktok','tiktokcdn-us.com'),('tiktok','muscdn.com'),
 ('instagram','instagram.c10r.facebook.com'),
 ('roblox','rbxinfra.com'),
 ('fortnite','epicgames.dev'),
 ('steam','steamserver.net'),('steam','steamcontent.com'),('steam','valve.net'),
 ('minecraft','mojang.com'),
 ('spotify','audio-fa.scdn.co'),
 ('facebook','facebook.com'),('facebook','fbcdn.net'),('facebook','facebook.net'),
 ('facebook','messenger.com'),('facebook','fb.com'),
 ('x','x.com'),('x','twitter.com'),('x','twimg.com'),('x','t.co'),
 ('reddit','reddit.com'),('reddit','redd.it'),('reddit','redditmedia.com'),('reddit','redditstatic.com'),
 ('discord','discord.com'),('discord','discordapp.com'),('discord','discordapp.net'),
 ('discord','discord.gg'),('discord','discord.media'),
 ('pinterest','pinterest.com'),('pinterest','pinimg.com'),
 ('whatsapp','whatsapp.com'),('whatsapp','whatsapp.net'),
 ('telegram','telegram.org'),('telegram','t.me'),('telegram','telegram.me'),
 ('playstation','playstation.com'),('playstation','playstation.net'),
 ('playstation','sonyentertainmentnetwork.com'),
 ('xbox','xbox.com'),('xbox','xboxlive.com'),('xbox','xboxservices.com'),
 ('nintendo','nintendo.com'),('nintendo','nintendo.net'),('nintendo','nintendowifi.net'),
 ('riot','riotgames.com'),('riot','leagueoflegends.com'),('riot','riotcdn.net'),
 ('battlenet','battle.net'),('battlenet','blizzard.com'),('battlenet','activision.com'),
 ('applemusic','music.apple.com'),
 ('soundcloud','soundcloud.com'),('soundcloud','sndcdn.com'),
 ('duolingo','duolingo.com')
) AS d(sname,domain) JOIN services s ON s.name=d.sname
ON CONFLICT DO NOTHING;

GRANT SELECT ON services, service_domains, service_ips, service_usage TO kids_app;
